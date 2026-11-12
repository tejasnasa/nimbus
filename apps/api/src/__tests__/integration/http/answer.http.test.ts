/**
 * @module api/__tests__/integration/http/answer.http
 * @description The agent's answer and notice routes over HTTP: the NDJSON
 * stream's shape, an error line on a refusal, the spoken reply stored as the
 * assistant's caption and broadcast, the chat fallback, addressed captions,
 * speech usage in the call log, and the budget notices posted to chat. The
 * model resolver is a stub that streams a scripted reply.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));

vi.mock("../../../lib/ai/entitlements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai/entitlements")>()),
  resolveAi: resolveMock,
}));

import request from "supertest";
import type { AnswerLine } from "@nimbus/types";
import { createApp } from "../../../app";
import { env } from "../../../lib/env";
import { issueTicket } from "../../../lib/meeting/tickets";
import {
  closeTestResources,
  createMeeting,
  createUser,
  createWorkspace,
  createWorkspaceAiCredential,
  fakeIo,
  refusingResolver,
  resetDatabase,
  stubResolver,
  testPrisma,
} from "@testhelpers";

const app = createApp();
const broadcasts = fakeIo();
app.set("io", broadcasts.io);
const bearer = { Authorization: `Bearer ${process.env.NIMBUS_AGENT_SECRET!}` };

afterAll(closeTestResources);

/** A stub `responses.create` that streams `text` and completes. */
const streaming = (text: string) =>
  vi.fn(async () => ({
    async *[Symbol.asyncIterator]() {
      for (const word of text.split(/(?<= )/)) {
        yield { type: "response.output_text.delta", delta: word };
      }
      yield { type: "response.completed", response: { output: [] } };
    },
  }));

/** Collects a streamed body as text. */
const collect = (
  res: NodeJS.ReadableStream,
  done: (e: Error | null, body: string) => void,
) => {
  let body = "";
  res.setEncoding?.("utf8");
  res.on("data", (chunk: string) => {
    body += chunk;
  });
  res.on("end", () => done(null, body));
};

const parseLines = (body: string): AnswerLine[] =>
  body
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AnswerLine);

describe("http: agent answer and notice", () => {
  let ownerId: string;
  let workspaceId: string;
  let meetingId: string;
  let session: string;

  const agent = (path: string) =>
    request(app)
      .post(`/internal/agent${path}`)
      .set(bearer)
      .set("X-Meeting-Session", session);

  const ask = (body: Record<string, unknown>) =>
    agent("/answer")
      .buffer(true)
      .parse(collect as never)
      .send(body);

  beforeEach(async () => {
    await resetDatabase();
    broadcasts.emitted.length = 0;
    resolveMock.mockReset();
    ownerId = (await createUser("Olive Owner")).id;
    workspaceId = (await createWorkspace(ownerId)).id;
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text", "transcription"],
    });
    meetingId = (
      await createMeeting(workspaceId, {
        startedById: ownerId,
        startedAt: new Date(Date.now() - 60_000),
      })
    ).id;
    const ticket = await issueTicket(meetingId);
    const res = await request(app)
      .post("/internal/agent/redeem")
      .set(bearer)
      .send({ ticket });
    session = res.body.responseObject.sessionToken;

    // The addressed question, posted the way the agent posts it.
    const posted = await agent("/segments").send({
      segments: [
        {
          seq: 1,
          speakerUserId: ownerId,
          speakerName: "Olive Owner",
          text: "Nimbus, what is the plan?",
          startMs: 1000,
          endMs: 3000,
          addressed: true,
        },
      ],
    });
    expect(posted.status).toBe(200);
  });

  it.each(["/answer", "/notice"])(
    "refuses %s without a session",
    async (path) => {
      const res = await request(app)
        .post(`/internal/agent${path}`)
        .set(bearer)
        .send({});
      expect(res.status).toBe(401);
    },
  );

  it("stores addressed captions as addressed", async () => {
    const row = await testPrisma.transcriptSegment.findUniqueOrThrow({
      where: { meetingId_seq: { meetingId, seq: 1 } },
    });
    expect(row.addressed).toBe(true);
    expect(row.fromAssistant).toBe(false);
  });

  it("streams NDJSON deltas, then done, and stores and broadcasts the reply", async () => {
    resolveMock.mockImplementation(
      stubResolver(streaming("The plan is to ship Friday.")),
    );

    const res = await ask({ seq: 1, replySeq: 2, speak: true });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/);
    expect(res.headers["cache-control"]).toBe("no-store");
    const lines = parseLines(res.body as string);
    expect(lines.slice(0, -1).every((line) => line.type === "delta")).toBe(
      true,
    );
    expect(
      lines
        .filter(
          (l): l is Extract<AnswerLine, { type: "delta" }> =>
            l.type === "delta",
        )
        .map((l) => l.text)
        .join(""),
    ).toBe("The plan is to ship Friday.");
    expect(lines.at(-1)).toEqual({
      type: "done",
      segmentSeq: 2,
      channel: "voice",
    });

    const stored = await testPrisma.transcriptSegment.findUniqueOrThrow({
      where: { meetingId_seq: { meetingId, seq: 2 } },
    });
    expect(stored).toMatchObject({
      fromAssistant: true,
      speakerName: "Nimbus",
      text: "The plan is to ship Friday.",
    });
    const meeting = await testPrisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });
    expect(meeting.lastSeq).toBe(2);
    const announced = broadcasts.emitted.filter(
      (e) => e.event === "meeting:segment",
    );
    expect(announced.at(-1)).toMatchObject({
      room: workspaceId,
      payload: {
        meetingId,
        segment: { seq: 2, fromAssistant: true, speakerName: "Nimbus" },
      },
    });
  });

  it("writes one error line when the model is refused", async () => {
    resolveMock.mockImplementation(refusingResolver());
    const res = await ask({ seq: 1, replySeq: 2, speak: true });
    expect(res.status).toBe(200);
    expect(parseLines(res.body as string)).toEqual([
      { type: "error", reason: "refused" },
    ]);
    expect(
      await testPrisma.transcriptSegment.count({
        where: { meetingId, fromAssistant: true },
      }),
    ).toBe(0);
  });

  it("writes a stopped line once the meeting has ended", async () => {
    await testPrisma.meeting.update({
      where: { id: meetingId },
      data: { status: "ENDED", endedAt: new Date() },
    });
    const res = await ask({ seq: 1, replySeq: 2, speak: true });
    expect(parseLines(res.body as string)).toEqual([
      { type: "error", reason: "stopped" },
    ]);
  });

  it("posts the reply to chat when the agent will not speak", async () => {
    resolveMock.mockImplementation(stubResolver(streaming("Ship on Friday.")));
    const res = await ask({ seq: 1, replySeq: 2, speak: false });
    expect(parseLines(res.body as string)).toEqual([
      { type: "done", segmentSeq: null, channel: "chat" },
    ]);
    expect(broadcasts.emitted.map((e) => e.event)).toEqual(
      expect.arrayContaining(["message:new", "meeting:assistant-state"]),
    );
  });

  it("rejects a malformed answer request before streaming", async () => {
    const res = await agent("/answer").send({
      seq: 0,
      replySeq: 2,
      speak: "yes",
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("records speech usage by characters", async () => {
    const res = await agent("/usage").send({
      entries: [
        {
          feature: "speech",
          model: "gpt-4o-mini-tts",
          characters: 120,
          latencyMs: 400,
          status: "OK",
        },
      ],
    });
    expect(res.status).toBe(200);
    const row = await testPrisma.aiCall.findFirstOrThrow({
      where: { meetingId },
    });
    expect(row).toMatchObject({ feature: "SPEECH", characters: 120 });
  });

  it("posts a budget notice to chat as NimbusBot, with the server's own words", async () => {
    const res = await agent("/notice").send({ kind: "budget-warning" });
    expect(res.status).toBe(200);
    expect(res.body.responseObject).toEqual({ stop: false });
    const message = await testPrisma.message.findFirstOrThrow({
      where: { workspaceId },
    });
    expect(message.content).toBe(
      "About thirty seconds of free assistant time left.",
    );
    expect(message.userId).toBe(env.BOT_USERID);
  });

  it("rejects an unknown notice", async () => {
    const res = await agent("/notice").send({
      kind: "anything",
      text: "free text",
    });
    expect(res.status).toBe(400);
    expect(await testPrisma.message.count({ where: { workspaceId } })).toBe(0);
  });
});
