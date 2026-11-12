/**
 * @module agent/__tests__/meetingSessionVoice
 * @description The session's voice: an addressed question answered out loud, a
 * plain caption left alone, the chat fallback, the Ask and Stop RPCs, a person
 * barging in, a bare wake word's chime and window, the budget notices, and the
 * voice turning itself off when its key is refused.
 *
 * The voice activity model is the real one, fed from the bundled fixtures; the
 * room, the Nimbus API, transcription and speech are fakes.
 */
import { EventEmitter } from "node:events";
import {
  ParticipantKind,
  RoomEvent,
  TrackKind,
  type RemoteAudioTrack,
} from "@livekit/rtc-node";
import {
  AGENT_NOTICE_TEXT,
  type AnswerLine,
  type AnswerRequest,
  type RedeemResponse,
  type SegmentIn,
  type UsageIn,
} from "@nimbus/types";
import { describe, expect, it, vi } from "vitest";
import type { AudioOutput } from "../output/speaker.js";
import {
  ANSWER_FLUSH_MS,
  MeetingSession,
  type ParticipantLike,
  type RoomLike,
  type RpcCall,
  type SessionClient,
} from "../session/meetingSession.js";
import { TtsError, type TtsRequest } from "../tts/openaiCompatibleTts.js";
import {
  concat,
  frameClock,
  paced,
  readFixture,
  silence,
  toFrames,
} from "./helpers/audio.js";
import { loadRealVad } from "./helpers/vad.js";

type Rpc = (call: RpcCall) => Promise<string>;

class FakeRoom extends EventEmitter {
  remoteParticipants = new Map<string, ParticipantLike>();
  rpc = new Map<string, Rpc>();
  localParticipant = {
    identity: "agent-self",
    registerRpcMethod: (method: string, handler: Rpc) => {
      this.rpc.set(method, handler);
    },
    unregisterRpcMethod: (method: string) => {
      this.rpc.delete(method);
    },
  };
}

const trackOf = (identity: string) =>
  ({
    kind: TrackKind.KIND_AUDIO,
    sid: identity,
  }) as unknown as RemoteAudioTrack;

function join(room: FakeRoom, identity: string, name: string) {
  const participant: ParticipantLike = {
    identity,
    name,
    kind: ParticipantKind.STANDARD,
    trackPublications: new Map([["t", { track: trackOf(identity) }]]),
  };
  room.remoteParticipants.set(identity, participant);
}

const oneUtterance = () =>
  paced(toFrames(concat(readFixture("speech.wav"), silence(1.5))));
const twoUtterances = () =>
  paced(
    toFrames(
      concat(
        readFixture("speech.wav"),
        silence(1.5),
        readFixture("speech2.wav"),
        silence(1.5),
      ),
    ),
  );

function fakeOutput() {
  const frames: Int16Array[] = [];
  let clears = 0;
  const output: AudioOutput & { close: () => Promise<void> } = {
    async captureFrame(samples) {
      frames.push(samples);
      await new Promise((r) => setTimeout(r, 1));
    },
    clearQueue() {
      clears += 1;
    },
    async waitForPlayout() {},
    close: vi.fn(async () => undefined),
  };
  return { output, frames, clears: () => clears };
}

type Script = (
  body: AnswerRequest,
  signal: AbortSignal,
) => AsyncGenerator<AnswerLine>;

const spoken = (text: string): Script =>
  async function* () {
    yield { type: "delta", text };
    yield { type: "done", segmentSeq: 2, channel: "voice" };
  };

const hanging: Script = async function* (_body, signal) {
  yield { type: "delta", text: "One thing. Another thing. " };
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve()),
  );
};

function fakeClient(script: Script) {
  const segments: SegmentIn[] = [];
  const states: string[] = [];
  const usage: UsageIn[] = [];
  const answers: Array<{ body: AnswerRequest; signal: AbortSignal }> = [];
  const order: string[] = [];
  const client = {
    queueSegment: vi.fn((s: SegmentIn) => {
      segments.push(s);
    }),
    flush: vi.fn(async (ms: number) => {
      order.push(`flush:${ms}`);
      return true;
    }),
    postState: vi.fn(async (s: { state: string }) => {
      states.push(s.state);
    }),
    postUsage: vi.fn(async (entries: UsageIn[]) => {
      usage.push(...entries);
      return true;
    }),
    postEnded: vi.fn(async () => undefined),
    onStop: vi.fn(),
    postNotice: vi.fn(async () => undefined),
    answer: vi.fn((body: AnswerRequest, signal: AbortSignal) => {
      order.push("answer");
      answers.push({ body, signal });
      return script(body, signal);
    }),
  } as unknown as SessionClient & { postNotice: ReturnType<typeof vi.fn> };
  return { client, segments, states, usage, answers, order };
}

const redeemed = (overrides: Partial<RedeemResponse> = {}): RedeemResponse => ({
  sessionToken: "s",
  meetingId: "m1",
  workspaceId: "w1",
  roomName: "nimbus-ws-w1",
  startedAt: new Date().toISOString(),
  members: [
    { userId: "u-riya", name: "Riya Shah" },
    { userId: "u-sam", name: "Sam Lee" },
  ],
  voice: {
    baseUrl: "https://voice.test/v1",
    apiKey: "k",
    transcribeModel: "stt",
    speechModel: "tts",
    voice: "default",
  },
  budgetSeconds: null,
  assistantSpeaks: true,
  wakeNames: ["nimbus", "nimbus bot", "nimbusbot"],
  ...overrides,
});

async function makeSession(opts: {
  script?: Script;
  texts?: string[];
  frames?: Record<string, () => AsyncIterable<unknown>>;
  people?: Array<[string, string]>;
  redeem?: Partial<RedeemResponse>;
  tts?: (
    request: TtsRequest,
  ) => Promise<{ sampleRate: number; chunks: AsyncIterable<Int16Array> }>;
  openVoice?: () => Promise<AudioOutput & { close?: () => Promise<void> }>;
  noVoice?: boolean;
}) {
  const room = new FakeRoom();
  for (const [identity, name] of opts.people ?? [["u-riya", "Riya"]])
    join(room, identity, name);
  const harness = fakeClient(opts.script ?? spoken("The plan is Friday."));
  const out = fakeOutput();
  const texts = [...(opts.texts ?? ["Nimbus, what is the plan?"])];
  const ttsInputs: string[] = [];
  const logs: string[] = [];
  const session = new MeetingSession(
    room as unknown as RoomLike,
    redeemed(opts.redeem),
    {
      vad: await loadRealVad(),
      client: harness.client,
      clock: frameClock(),
      openFrames: (track) => {
        const identity = (track as unknown as { sid: string }).sid;
        const make = opts.frames?.[identity] ?? oneUtterance;
        return { frames: make() as never, close: async () => undefined };
      },
      disconnect: async () => undefined,
      stt: async () => ({ text: texts.shift() ?? "and that is all" }),
      openVoice: opts.noVoice
        ? undefined
        : (opts.openVoice ?? (async () => out.output)),
      tts:
        opts.tts ??
        (async (request) => {
          ttsInputs.push(request.input);
          request.onUsage?.({
            feature: "speech",
            model: request.model,
            characters: request.input.length,
            latencyMs: 5,
            status: "OK",
          });
          return {
            sampleRate: 24_000,
            chunks: (async function* () {
              yield new Int16Array(960).fill(2000);
            })(),
          };
        }),
      log: (message) => logs.push(message),
    },
  );
  return { room, session, out, ttsInputs, logs, ...harness };
}

/**
 * A track whose speech starts only once `gate` resolves, then plays in real
 * time, so its voice activity lasts as long on the clock as it would in a call.
 */
function gated(gate: Promise<void>) {
  return () =>
    (async function* () {
      yield* paced(toFrames(silence(0.5)));
      await gate;
      for (const frame of toFrames(
        concat(readFixture("speech2.wav"), silence(1.5)),
      )) {
        yield frame;
        await new Promise((r) => setTimeout(r, 10));
      }
    })();
}

describe("MeetingSession voice", () => {
  it("answers an addressed question out loud", async () => {
    const h = await makeSession({});
    h.session.start();
    await vi.waitFor(() => expect(h.answers).toHaveLength(1), {
      timeout: 10_000,
    });
    await vi.waitFor(() => expect(h.states.at(-1)).toBe("listening"), {
      timeout: 5000,
    });
    await h.session.stop("shutdown");

    expect(h.segments[0]).toMatchObject({ seq: 1, addressed: true });
    expect(h.answers[0]!.body).toEqual({ seq: 1, replySeq: 2, speak: true });
    expect(h.order.slice(0, 2)).toEqual([`flush:${ANSWER_FLUSH_MS}`, "answer"]);
    expect(h.ttsInputs).toEqual(["The plan is Friday."]);
    expect(h.out.frames.length).toBeGreaterThan(0);
    const thinking = h.states.indexOf("thinking");
    expect(thinking).toBeGreaterThan(-1);
    expect(h.states.indexOf("speaking")).toBeGreaterThan(thinking);
    expect(
      h.usage.some((u) => u.feature === "speech" && u.characters === 19),
    ).toBe(true);
    expect(h.out.output.close).toHaveBeenCalledOnce();
    expect(h.room.rpc.size).toBe(0);
  });

  it("captions a sentence that only mentions the assistant, without answering", async () => {
    const h = await makeSession({ texts: ["Nimbus is the product name"] });
    h.session.start();
    await vi.waitFor(() => expect(h.segments).toHaveLength(1), {
      timeout: 10_000,
    });
    await h.session.stop("shutdown");
    expect(h.segments[0]!.addressed).toBeUndefined();
    expect(h.answers).toHaveLength(0);
  });

  it("asks for a chat answer when the assistant may not speak", async () => {
    const chat: Script = async function* () {
      yield { type: "done", segmentSeq: null, channel: "chat" };
    };
    const h = await makeSession({
      script: chat,
      redeem: { assistantSpeaks: false },
    });
    h.session.start();
    await vi.waitFor(() => expect(h.answers).toHaveLength(1), {
      timeout: 10_000,
    });
    expect(h.answers[0]!.body.speak).toBe(false);
    // The API announced "answered in chat"; the agent waits before listening.
    await new Promise((r) => setTimeout(r, 200));
    expect(h.states.at(-1)).toBe("thinking");
    await vi.waitFor(() => expect(h.states.at(-1)).toBe("listening"), {
      timeout: 6000,
    });
    await h.session.stop("shutdown");
    expect(h.out.frames).toHaveLength(0);
  });

  it("addresses what is said while the Ask button is held", async () => {
    const h = await makeSession({ texts: ["what is the plan"] });
    h.session.start();
    const ask = h.room.rpc.get("nimbus.ask")!;
    expect(
      await ask({ callerIdentity: "u-riya", payload: '{"pressed":true}' }),
    ).toBe('{"ok":true}');
    await vi.waitFor(() => expect(h.answers).toHaveLength(1), {
      timeout: 10_000,
    });
    await ask({ callerIdentity: "u-riya", payload: "not json" });
    await h.session.stop("shutdown");
    expect(h.segments[0]!.addressed).toBe(true);
    // Once stopped, the button does nothing.
    await ask({ callerIdentity: "u-riya", payload: '{"pressed":true}' });
  });

  it("stops speaking on the Stop RPC", async () => {
    const h = await makeSession({ script: hanging });
    h.session.start();
    await vi.waitFor(() => expect(h.out.frames.length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    expect(
      await h.room.rpc.get("nimbus.stop")!({
        callerIdentity: "u-riya",
        payload: "",
      }),
    ).toBe('{"ok":true}');
    expect(h.answers[0]!.signal.aborted).toBe(true);
    expect(h.out.clears()).toBeGreaterThan(0);
    expect(h.states.at(-1)).toBe("listening");
    await h.session.stop("shutdown");
  });

  it("is interrupted by someone talking over it", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const h = await makeSession({
      script: hanging,
      texts: ["Nimbus, what is the plan?", "hold on a second"],
      people: [
        ["u-riya", "Riya"],
        ["u-sam", "Sam"],
      ],
      frames: { "u-riya": oneUtterance, "u-sam": gated(gate) },
    });
    h.session.start();
    await vi.waitFor(() => expect(h.out.frames.length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    open();
    await vi.waitFor(() => expect(h.answers[0]!.signal.aborted).toBe(true), {
      timeout: 10_000,
    });
    expect(h.out.clears()).toBeGreaterThan(0);
    await vi.waitFor(() => expect(h.segments).toHaveLength(2), {
      timeout: 10_000,
    });
    await h.session.stop("shutdown");
    // The interruption was not itself addressed, so nothing new was asked.
    expect(h.answers).toHaveLength(1);
  });

  it("chimes at a bare wake word and answers the next utterance", async () => {
    const h = await makeSession({
      texts: ["Nimbus?", "what is the plan"],
      frames: { "u-riya": twoUtterances },
    });
    h.session.start();
    await vi.waitFor(() => expect(h.answers).toHaveLength(1), {
      timeout: 15_000,
    });
    await h.session.stop("shutdown");
    expect(h.segments[0]).toMatchObject({ seq: 1, addressed: true });
    expect(h.answers[0]!.body.seq).toBe(2);
    expect(h.out.frames.length).toBeGreaterThan(0);
  });

  it("warns, speaking, before the free time runs out", async () => {
    const h = await makeSession({
      texts: ["just chatting"],
      redeem: { budgetSeconds: 31 },
    });
    h.session.start();
    await vi.waitFor(
      () => expect(h.ttsInputs).toContain(AGENT_NOTICE_TEXT["budget-warning"]),
      {
        timeout: 5000,
      },
    );
    await h.session.stop("shutdown");
    expect(h.client.postNotice).not.toHaveBeenCalled();
  });

  it("says the free time is over, then leaves", async () => {
    const h = await makeSession({
      texts: ["just chatting"],
      redeem: { budgetSeconds: 1 },
    });
    h.session.start();
    await vi.waitFor(
      () => expect(h.client.postEnded).toHaveBeenCalledWith("budget"),
      {
        timeout: 10_000,
      },
    );
    expect(h.ttsInputs.join(" ")).toBe(AGENT_NOTICE_TEXT["budget-ended"]);
  });

  it("posts the budget notices to chat when it has no voice", async () => {
    const h = await makeSession({
      texts: ["just chatting"],
      noVoice: true,
      redeem: { budgetSeconds: 1 },
    });
    h.session.start();
    await vi.waitFor(
      () => expect(h.client.postEnded).toHaveBeenCalledWith("budget"),
      {
        timeout: 10_000,
      },
    );
    expect(h.client.postNotice).toHaveBeenCalledWith("budget-ended");
  });

  it("answers in chat once the speech key is refused", async () => {
    const h = await makeSession({
      texts: ["Nimbus, first question?", "Nimbus, second question?"],
      frames: { "u-riya": twoUtterances },
      tts: async () => {
        throw new TtsError("auth", 401);
      },
    });
    h.session.start();
    await vi.waitFor(() => expect(h.answers).toHaveLength(2), {
      timeout: 15_000,
    });
    await h.session.stop("shutdown");
    expect(h.answers[0]!.body.speak).toBe(true);
    expect(h.answers[1]!.body.speak).toBe(false);
    expect(h.logs).toContain("speech key refused; answering in chat");
  });

  it("answers in chat when the voice track cannot be published", async () => {
    const h = await makeSession({
      openVoice: async () => {
        throw new Error("publish failed");
      },
    });
    h.session.start();
    await vi.waitFor(() => expect(h.answers).toHaveLength(1), {
      timeout: 10_000,
    });
    await h.session.stop("shutdown");
    expect(h.answers[0]!.body.speak).toBe(false);
    expect(h.logs).toContain(
      "could not publish the voice track; answering in chat",
    );
  });

  it("closes a voice track that arrives after the session stopped", async () => {
    let finish!: () => void;
    const late = fakeOutput();
    const h = await makeSession({
      openVoice: () =>
        new Promise((resolve) => {
          finish = () => resolve(late.output);
        }),
    });
    h.session.start();
    await h.session.stop("shutdown");
    finish();
    await vi.waitFor(() => expect(late.output.close).toHaveBeenCalledOnce());
  });

  it("ends the answer quietly when the answer request fails", async () => {
    const failing: Script = async function* () {
      yield { type: "error", reason: "refused" };
    };
    const h = await makeSession({ script: failing });
    h.session.start();
    await vi.waitFor(() => expect(h.answers).toHaveLength(1), {
      timeout: 10_000,
    });
    await vi.waitFor(() => expect(h.states.at(-1)).toBe("listening"));
    await h.session.stop("shutdown");
    expect(h.out.frames).toHaveLength(0);
  });

  it("listens to a participant who joins while holding the Ask button", async () => {
    const h = await makeSession({ people: [], texts: ["what is the plan"] });
    h.session.start();
    await h.room.rpc.get("nimbus.ask")!({
      callerIdentity: "u-sam",
      payload: '{"pressed":true}',
    });
    join(h.room, "u-sam", "Sam");
    h.room.emit(
      RoomEvent.TrackSubscribed,
      trackOf("u-sam"),
      {},
      h.room.remoteParticipants.get("u-sam"),
    );
    await vi.waitFor(() => expect(h.answers).toHaveLength(1), {
      timeout: 10_000,
    });
    await h.session.stop("shutdown");
  });
});
