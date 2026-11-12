/**
 * @module api/__tests__/unit/assistant
 * @description The in-call assistant's answer loop against a scripted fake
 * model: a tool round trip, the four-round cap, the wall clock, write tools
 * committing before any text is sent, cancellation stopping tool execution,
 * the chat fallback, and the default streamed round. Postgres and Redis are
 * real; the model is a script.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerLine } from "@nimbus/types";
import { prisma } from "@nimbus/db";
import {
  answer,
  buildAnswerInput,
  buildAnswerInstructions,
  MAX_TOOL_ROUNDS,
  runningAnswers,
  type AnswerMeeting,
  type ModelRound,
  type RoundRequest,
} from "../../lib/meeting/assistant";
import { stateKey } from "../../lib/meeting/lifecycle";
import { env } from "../../lib/env";
import { pubClient } from "../../lib/redis";
import {
  addMember,
  closeTestResources,
  createMeeting,
  createUser,
  createWorkspace,
  fakeIo,
  refusingResolver,
  resetDatabase,
  stubResolver,
  testPrisma,
} from "@testhelpers";

afterAll(closeTestResources);

const call = (name: string, args: unknown, id = `call-${name}`) => ({
  type: "function_call",
  name,
  arguments: JSON.stringify(args),
  call_id: id,
});

/** A model that plays back one scripted round per call. */
function scripted(
  rounds: Array<
    (
      request: RoundRequest,
      onDelta?: (t: string) => void,
    ) => {
      output?: unknown[];
      text?: string;
    }
  >,
) {
  const requests: RoundRequest[] = [];
  const round: ModelRound = async (_handle, request, options) => {
    requests.push({ ...request, input: [...request.input] });
    const step = rounds[Math.min(requests.length - 1, rounds.length - 1)]!;
    const result = step(request, options.onDelta);
    return { output: result.output ?? [], text: result.text ?? "" };
  };
  return { round, requests };
}

/** Streams text through the live callback, as the forced round does. */
const say =
  (text: string) => (_r: RoundRequest, onDelta?: (t: string) => void) => {
    if (onDelta) for (const word of text.split(/(?<= )/)) onDelta(word);
    return { text };
  };

describe("answer", () => {
  let ownerId: string;
  let speakerId: string;
  let workspaceId: string;
  let meeting: AnswerMeeting;
  const broadcasts = fakeIo();
  const lines: AnswerLine[] = [];

  const run = (
    overrides: Partial<Parameters<typeof answer>[0]> = {},
    modelRound?: ModelRound,
  ) =>
    answer({
      meeting,
      seq: 2,
      replySeq: 3,
      speak: true,
      signal: new AbortController().signal,
      emit: (line) => lines.push(line),
      io: broadcasts.io,
      deps: {
        resolve: stubResolver(vi.fn()),
        modelRound,
        segmentWaitMs: 0,
        now: () => new Date(meeting.startedAt.getTime() + 120_000),
      },
      ...overrides,
    });

  const deltas = () =>
    lines
      .filter(
        (l): l is Extract<AnswerLine, { type: "delta" }> => l.type === "delta",
      )
      .map((l) => l.text)
      .join("");
  const last = () => lines[lines.length - 1];

  beforeEach(async () => {
    await resetDatabase();
    lines.length = 0;
    broadcasts.emitted.length = 0;
    ownerId = (await createUser("Ada Lovelace")).id;
    speakerId = (await createUser("Grace Hopper")).id;
    workspaceId = (await createWorkspace(ownerId)).id;
    await addMember(workspaceId, speakerId, "MEMBER");
    const row = await createMeeting(workspaceId, {
      startedById: ownerId,
      startedAt: new Date(Date.now() - 120_000),
    });
    meeting = row;
    await testPrisma.transcriptSegment.createMany({
      data: [
        {
          meetingId: row.id,
          seq: 1,
          speakerName: "Ada Lovelace",
          speakerUserId: ownerId,
          text: "We moved auth to rotating tokens.",
          startMs: 10_000,
          endMs: 14_000,
        },
        {
          meetingId: row.id,
          seq: 2,
          speakerName: "Grace Hopper",
          speakerUserId: speakerId,
          text: "Nimbus, what did we decide about auth?",
          startMs: 100_000,
          endMs: 104_000,
          addressed: true,
        },
      ],
    });
  });

  it("builds instructions with the date and the meeting's start", () => {
    const text = buildAnswerInstructions({
      now: new Date("2026-11-12T09:30:00Z"),
      startedAt: new Date("2026-11-12T09:00:00Z"),
      speak: true,
    });
    expect(text).toContain("Today is 2026-11-12");
    expect(text).toContain("started at 2026-11-12 09:00 UTC");
    expect(text).toContain("No markdown, no lists, no URLs");
    expect(text).toContain("<tool_result>");
    expect(
      buildAnswerInstructions({
        now: new Date(),
        startedAt: new Date(),
        speak: false,
      }),
    ).toContain("posted in the workspace chat");
  });

  it("fences the summary and transcript as data", () => {
    const input = buildAnswerInput({
      summary: null,
      transcript: "",
      speakerName: "Grace",
      question: "Hi?",
    });
    expect(input).toContain(
      "<meeting_summary>\n(none yet)\n</meeting_summary>",
    );
    expect(input).toContain(
      "<recent_transcript>\n(nothing yet)\n</recent_transcript>",
    );
    expect(input).toContain('Grace just said to you: "Hi?"');
  });

  it("runs a tool round trip, streams the reply, and stores it as the assistant", async () => {
    const model = scripted([
      () => ({
        output: [call("search_meetings", { query: "auth", since_days: null })],
      }),
      () => ({
        text: "You decided to rotate the auth tokens. That was this call.",
      }),
    ]);
    await run({}, model.round);

    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]!.tools.map((t) => t.name)).toContain(
      "get_transcript",
    );
    const first = model.requests[0]!.input[0] as { content: string };
    expect(first.content).toContain("Grace Hopper just said to you");
    expect(first.content).toContain("We moved auth to rotating tokens.");
    const second = model.requests[1]!.input;
    expect(second[2]).toMatchObject({
      type: "function_call_output",
      call_id: "call-search_meetings",
    });
    expect((second[2] as { output: string }).output).toMatch(
      /^<tool_result name="search_meetings">/,
    );

    expect(deltas()).toBe(
      "You decided to rotate the auth tokens. That was this call.",
    );
    expect(lines.filter((l) => l.type === "delta").length).toBe(2);
    expect(last()).toEqual({ type: "done", segmentSeq: 3, channel: "voice" });

    const stored = await testPrisma.transcriptSegment.findUniqueOrThrow({
      where: { meetingId_seq: { meetingId: meeting.id, seq: 3 } },
    });
    expect(stored).toMatchObject({
      fromAssistant: true,
      speakerName: "Nimbus",
      speakerUserId: null,
      text: "You decided to rotate the auth tokens. That was this call.",
    });
    expect(broadcasts.emitted).toContainEqual(
      expect.objectContaining({ event: "meeting:segment", room: workspaceId }),
    );
    expect(runningAnswers()).toBe(0);
  });

  it("stops offering tools after four rounds and forces an answer", async () => {
    let n = 0;
    const model = scripted([
      (request) =>
        request.toolChoice === "none"
          ? say("I could not find it.")(request)
          : {
              output: [call("list_meetings", { since_days: null }, `c${n++}`)],
            },
    ]);
    const live: string[] = [];
    await run({}, async (handle, request, options) =>
      model.round(handle, request, {
        ...options,
        onDelta: options.onDelta
          ? (t) => {
              live.push(t);
              options.onDelta!(t);
            }
          : undefined,
      }),
    );
    expect(model.requests).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(
      model.requests.slice(0, MAX_TOOL_ROUNDS).every((r) => !r.toolChoice),
    ).toBe(true);
    expect(model.requests[MAX_TOOL_ROUNDS]!.toolChoice).toBe("none");
    expect(last()).toMatchObject({ type: "done", channel: "voice" });
  });

  it("gives up after the wall clock with a timeout", async () => {
    const hang: ModelRound = (_h, _r, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(options.signal.reason),
        );
      });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await answer({
      meeting,
      seq: 2,
      replySeq: 3,
      speak: true,
      signal: new AbortController().signal,
      emit: (line) => lines.push(line),
      deps: {
        resolve: stubResolver(vi.fn()),
        modelRound: hang,
        wallClockMs: 50,
        segmentWaitMs: 0,
      },
    });
    error.mockRestore();
    expect(lines).toEqual([{ type: "error", reason: "timeout" }]);
  });

  it("keeps what was already said when the wall clock runs out mid-answer", async () => {
    const model: ModelRound = (_h, request, options) => {
      if (!request.toolChoice) {
        return Promise.resolve({
          output: [call("list_meetings", { since_days: null })],
          text: "",
        });
      }
      options.onDelta?.("Half an answer. ");
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(options.signal.reason),
        );
      });
    };
    await answer({
      meeting,
      seq: 2,
      replySeq: 3,
      speak: true,
      signal: new AbortController().signal,
      emit: (line) => lines.push(line),
      deps: {
        resolve: stubResolver(vi.fn()),
        wallClockMs: 2000,
        segmentWaitMs: 0,
        modelRound: model,
      },
    });
    expect(deltas()).toBe("Half an answer. ");
    expect(last()).toEqual({ type: "done", segmentSeq: 3, channel: "voice" });
  });

  it("commits write tools before any text is sent, and drops text from a tool round", async () => {
    const order: string[] = [];
    const original = prisma.actionItem.create.bind(prisma.actionItem);
    const spy = vi.spyOn(prisma.actionItem, "create").mockImplementation(((
      args: never,
    ) =>
      original(args).then((row: unknown) => {
        order.push("write");
        return row;
      })) as never);
    const model = scripted([
      () => ({
        text: "Sure, adding that now.",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Sure, adding that now." }],
          },
          call("create_action_item", {
            text: "Rotate the keys",
            owner_name: "Ada",
            due: null,
          }),
        ],
      }),
      () => ({ text: "Added: rotate the keys, for Ada." }),
    ]);
    await run(
      {
        emit: (line) => {
          if (line.type === "delta") order.push("delta");
          lines.push(line);
        },
      },
      model.round,
    );
    spy.mockRestore();

    expect(order[0]).toBe("write");
    expect(order.filter((o) => o === "write")).toHaveLength(1);
    expect(deltas()).toBe("Added: rotate the keys, for Ada.");
    const item = await testPrisma.actionItem.findFirstOrThrow({
      where: { text: "Rotate the keys" },
    });
    expect(item).toMatchObject({
      meetingId: meeting.id,
      createdById: speakerId,
      ownerUserId: ownerId,
    });
  });

  it("stops executing tools once cancelled, and stores nothing", async () => {
    const controller = new AbortController();
    const model = scripted([
      () => {
        controller.abort();
        return {
          output: [
            call(
              "create_action_item",
              { text: "One", owner_name: null, due: null },
              "a",
            ),
            call(
              "create_action_item",
              { text: "Two", owner_name: null, due: null },
              "b",
            ),
          ],
        };
      },
    ]);
    await run({ signal: controller.signal }, model.round);
    expect(lines).toEqual([]);
    expect(
      await testPrisma.actionItem.count({ where: { meetingId: meeting.id } }),
    ).toBe(0);
    expect(
      await testPrisma.transcriptSegment.count({
        where: { meetingId: meeting.id, seq: 3 },
      }),
    ).toBe(0);
  });

  it("posts the reply to chat when the assistant may not speak", async () => {
    const model = scripted([
      () => ({ text: "Rotating tokens, decided today." }),
    ]);
    await run({ speak: false }, model.round);

    expect(lines).toEqual([
      { type: "done", segmentSeq: null, channel: "chat" },
    ]);
    const message = await testPrisma.message.findFirstOrThrow({
      where: { workspaceId },
    });
    expect(message.content).toBe("Rotating tokens, decided today.");
    expect(message.userId).toBe(env.BOT_USERID);
    expect(broadcasts.emitted).toContainEqual({
      room: workspaceId,
      event: "meeting:assistant-state",
      payload: { meetingId: meeting.id, state: "answered-in-chat" },
    });
    expect(await pubClient.get(stateKey(meeting.id))).toBe("answered-in-chat");
    expect(
      await testPrisma.transcriptSegment.count({
        where: { meetingId: meeting.id, seq: 3 },
      }),
    ).toBe(0);
  });

  it("answers a refusal with one error line", async () => {
    await run({ deps: { resolve: refusingResolver(), segmentWaitMs: 0 } });
    expect(lines).toEqual([{ type: "error", reason: "refused" }]);
  });

  it("answers for a meeting that is not live with one error line", async () => {
    await run({ meeting: { ...meeting, status: "ENDED" } });
    expect(lines).toEqual([{ type: "error", reason: "stopped" }]);
  });

  it("answers for a meeting with no starter with one error line", async () => {
    await run({ meeting: { ...meeting, startedById: null } });
    expect(lines).toEqual([{ type: "error", reason: "refused" }]);
  });

  it("answers an unknown segment with one error line", async () => {
    await run({ seq: 99 }, scripted([() => ({ text: "never" })]).round);
    expect(lines).toEqual([{ type: "error", reason: "not-found" }]);
  });

  it("answers with an error when the model says nothing", async () => {
    await run({}, scripted([() => ({ text: "   " })]).round);
    expect(lines).toEqual([{ type: "error", reason: "failed" }]);
  });

  it("reports a failed model call as failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await run({}, async () => {
      throw new Error("provider down");
    });
    error.mockRestore();
    expect(lines).toEqual([{ type: "error", reason: "failed" }]);
  });

  it("cancels the previous answer for the same meeting", async () => {
    const firstLines: AnswerLine[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: ModelRound = async (_h, _r, options) => {
      await gate;
      options.signal.throwIfAborted();
      return { output: [], text: "old" };
    };
    const first = run({ emit: (l) => firstLines.push(l) }, slow);
    await vi.waitFor(() => expect(runningAnswers()).toBe(1));
    const second = run({}, scripted([() => ({ text: "New answer." })]).round);
    release();
    await Promise.all([first, second]);
    expect(firstLines).toEqual([]);
    expect(deltas()).toBe("New answer.");
  });

  it("streams through the Responses API by default and logs the call", async () => {
    const events = [
      { type: "response.output_text.delta", delta: "Hello " },
      { type: "response.output_text.delta", delta: "there." },
      {
        type: "response.completed",
        response: { output: [], usage: { input_tokens: 10, output_tokens: 3 } },
      },
    ];
    const create = vi.fn(async () => ({
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    }));
    await run({ deps: { resolve: stubResolver(create), segmentWaitMs: 0 } });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true, model: "test-model" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(deltas()).toBe("Hello there.");
    await vi.waitFor(async () => {
      const calls = await testPrisma.aiCall.findMany({
        where: { meetingId: meeting.id },
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        status: "OK",
        feature: "MEETING",
        inputTokens: 10,
      });
    });
  });

  it("logs a failed streamed call", async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error("boom"), { status: 500 });
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await run({ deps: { resolve: stubResolver(create), segmentWaitMs: 0 } });
    error.mockRestore();
    expect(lines).toEqual([{ type: "error", reason: "failed" }]);
    await vi.waitFor(async () => {
      const calls = await testPrisma.aiCall.findMany({
        where: { meetingId: meeting.id },
      });
      expect(calls[0]).toMatchObject({ status: "ERROR" });
    });
  });
});
