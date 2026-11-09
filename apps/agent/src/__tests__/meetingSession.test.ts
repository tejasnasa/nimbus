/**
 * @module agent/__tests__/meetingSession
 * @description A whole session against a fake room: tracks arriving, speech
 * becoming captions, state posts, the budget and empty-room endings, and the
 * order in which a stopping session tidies up.
 *
 * The voice activity model is the real one, fed from the bundled fixtures; the
 * room, the Nimbus API and the transcription provider are fakes.
 */
import { EventEmitter } from "node:events";
import { ParticipantKind, RoomEvent, TrackKind, type RemoteAudioTrack } from "@livekit/rtc-node";
import type { RedeemResponse, SegmentIn, UsageIn } from "@nimbus/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MeetingSession,
  USAGE_INTERVAL_MS,
  type ParticipantLike,
  type RoomLike,
  type SessionClient,
} from "../session/meetingSession.js";
import { createMeetingClock } from "../session/clock.js";
import { SttError, type SttRequest } from "../stt/openaiCompatibleStt.js";
import { concat, frameClock, paced, readFixture, silence, toFrames } from "./helpers/audio.js";
import { loadRealVad } from "./helpers/vad.js";

class FakeRoom extends EventEmitter {
  remoteParticipants = new Map<string, ParticipantLike>();
  localParticipant = { identity: "agent-self" };
}

const audioTrack = { kind: TrackKind.KIND_AUDIO } as unknown as RemoteAudioTrack;

const person = (identity: string, name: string): ParticipantLike => ({
  identity,
  name,
  kind: ParticipantKind.STANDARD,
  trackPublications: new Map(),
});

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
  voice: { baseUrl: "https://stt.test/v1", apiKey: "k", transcribeModel: "fake" },
  budgetSeconds: null,
  assistantSpeaks: false,
  wakeNames: ["nimbus"],
  ...overrides,
});

function fakeClient() {
  const segments: SegmentIn[] = [];
  const states: Array<{ state: string; speakingUserIds?: string[] }> = [];
  const usage: UsageIn[] = [];
  const order: string[] = [];
  let stopHandler: (() => void) | undefined;
  const client = {
    queueSegment: vi.fn((s: SegmentIn) => {
      segments.push(s);
    }),
    flush: vi.fn(async () => {
      order.push("flush");
      return true;
    }),
    postState: vi.fn(async (s: { state: string; speakingUserIds?: string[] }) => {
      states.push(s);
    }),
    postUsage: vi.fn(async (entries: UsageIn[]) => {
      order.push("usage");
      usage.push(...entries);
      return true;
    }),
    postEnded: vi.fn(async (reason: string) => {
      order.push(`ended:${reason}`);
    }),
    onStop: vi.fn((handler: () => void) => {
      stopHandler = handler;
    }),
  } as unknown as SessionClient;
  return { client, segments, states, usage, order, stop: () => stopHandler?.() };
}

async function makeSession(opts: {
  room?: FakeRoom;
  redeem?: Partial<RedeemResponse>;
  stt?: (r: SttRequest) => Promise<{ text: string }>;
  frames?: (track: RemoteAudioTrack) => AsyncIterable<never>;
} = {}) {
  const room = opts.room ?? new FakeRoom();
  const harness = fakeClient();
  const disconnect = vi.fn(async () => {
    harness.order.push("disconnect");
  });
  const vad = await loadRealVad();
  const session = new MeetingSession(room as unknown as RoomLike, redeemed(opts.redeem), {
    vad,
    client: harness.client,
    clock: frameClock(),
    openFrames: () => ({
      frames: (opts.frames?.(audioTrack) ??
        paced(toFrames(concat(readFixture("speech.wav"), silence(1.5))))) as never,
      close: async () => undefined,
    }),
    disconnect,
    stt: opts.stt ?? (async () => ({ text: "hello team" })),
  });
  return { room, session, disconnect, ...harness };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("MeetingSession", () => {
  it("captions a participant who is already in the room, under their member name", async () => {
    const room = new FakeRoom();
    const riya = person("u-riya", "riya (display)");
    riya.trackPublications!.set("t", { track: audioTrack });
    room.remoteParticipants.set(riya.identity, riya);
    const { session, segments, states, usage, order, disconnect } = await makeSession({ room });

    session.start();
    await vi.waitFor(() => expect(segments).toHaveLength(1), { timeout: 10_000 });
    await session.stop("shutdown");

    expect(segments[0]).toMatchObject({
      seq: 1,
      speakerUserId: "u-riya",
      speakerName: "Riya Shah",
      text: "hello team",
    });
    expect(segments[0]!.endMs).toBeGreaterThan(segments[0]!.startMs);
    // Speaking was reported, then cleared.
    expect(states[0]).toEqual({ state: "listening", speakingUserIds: [] });
    expect(states.some((s) => s.speakingUserIds?.includes("u-riya"))).toBe(true);
    expect(usage).toHaveLength(1);
    // Leaving happens in a fixed order, ending with the disconnect.
    expect(order).toEqual(["flush", "usage", "ended:agent-ended", "disconnect"]);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("starts listening when a track arrives later, and skips agents and itself", async () => {
    const { room, session, segments } = await makeSession();
    session.start();

    const bot = { ...person("agent-other", "Another agent"), kind: ParticipantKind.AGENT };
    const self = person("agent-self", "me");
    room.emit(RoomEvent.TrackSubscribed, audioTrack, {}, bot);
    room.emit(RoomEvent.TrackSubscribed, audioTrack, {}, self);
    await new Promise((r) => setTimeout(r, 300));
    expect(segments).toHaveLength(0);

    room.emit(RoomEvent.TrackSubscribed, audioTrack, {}, person("u-sam", "Sam"));
    await vi.waitFor(() => expect(segments).toHaveLength(1), { timeout: 10_000 });
    expect(segments[0]!.speakerName).toBe("Sam Lee");

    await session.stop("shutdown");
  });

  it("names a participant who is not a member by their room name", async () => {
    const { room, session, segments } = await makeSession();
    session.start();

    room.emit(RoomEvent.TrackSubscribed, audioTrack, {}, person("u-guest", "Guest Gus"));
    await vi.waitFor(() => expect(segments).toHaveLength(1), { timeout: 10_000 });

    expect(segments[0]).toMatchObject({ speakerUserId: "u-guest", speakerName: "Guest Gus" });
    await session.stop("shutdown");
  });

  it("ignores a non-audio track", async () => {
    const { room, session, segments } = await makeSession();
    session.start();

    room.emit(
      RoomEvent.TrackSubscribed,
      { kind: TrackKind.KIND_VIDEO },
      {},
      person("u-sam", "Sam"),
    );
    await new Promise((r) => setTimeout(r, 300));

    expect(segments).toHaveLength(0);
    await session.stop("shutdown");
  });

  it("cuts off a participant's sentence when their track is unsubscribed", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { room, session, segments } = await makeSession({
      frames: () =>
        (async function* () {
          yield* paced(toFrames(readFixture("speech.wav").subarray(0, 16_000 * 3)));
          await held;
        })() as never,
    });
    session.start();
    const sam = person("u-sam", "Sam");
    room.emit(RoomEvent.TrackSubscribed, audioTrack, {}, sam);
    await new Promise((r) => setTimeout(r, 1500));

    room.emit(RoomEvent.TrackUnsubscribed, audioTrack, {}, sam);
    release();
    await vi.waitFor(() => expect(segments).toHaveLength(1), { timeout: 10_000 });
    await session.stop("shutdown");
  });

  it("ends with the budget reason when the free time runs out", async () => {
    vi.useFakeTimers();
    const { session, order, disconnect } = await makeSession({
      redeem: { budgetSeconds: 30 },
    });
    session.start();

    await vi.advanceTimersByTimeAsync(29_000);
    expect(disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);

    expect(order).toContain("ended:budget");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("counts the time the agent spent arriving against the budget", async () => {
    vi.useFakeTimers();
    const startedAt = new Date(Date.now() - 20_000).toISOString();
    const room = new FakeRoom();
    const harness = fakeClient();
    const disconnect = vi.fn();
    const session = new MeetingSession(
      room as unknown as RoomLike,
      redeemed({ budgetSeconds: 30, startedAt }),
      {
        vad: await loadRealVad(),
        client: harness.client,
        clock: createMeetingClock(startedAt),
        openFrames: () => ({ frames: paced([]), close: async () => undefined }),
        disconnect,
      },
    );
    session.start();

    await vi.advanceTimersByTimeAsync(9_000);
    expect(disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("leaves after a minute with no one in the room", async () => {
    vi.useFakeTimers();
    const room = new FakeRoom();
    const sam = person("u-sam", "Sam");
    room.remoteParticipants.set(sam.identity, sam);
    const { session, order, disconnect } = await makeSession({ room });
    session.start();

    room.remoteParticipants.delete(sam.identity);
    room.emit(RoomEvent.ParticipantDisconnected, sam);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);

    expect(order).toContain("ended:agent-ended");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("does not count other agents as people", async () => {
    vi.useFakeTimers();
    const room = new FakeRoom();
    room.remoteParticipants.set("agent-x", {
      ...person("agent-x", "Another"),
      kind: ParticipantKind.AGENT,
    });
    const { session, disconnect } = await makeSession({ room });
    session.start();

    await vi.advanceTimersByTimeAsync(61_000);

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("stops with the stopped reason when the API says stop", async () => {
    const { session, stop, order } = await makeSession();
    session.start();

    stop();
    await session.stop("shutdown"); // returns the same stop already in progress

    expect(order.filter((o) => o.startsWith("ended"))).toEqual(["ended:stopped"]);
  });

  it("stops when the provider rejects the key", async () => {
    const { room, session, order } = await makeSession({
      stt: async () => {
        throw new SttError("auth", 401);
      },
    });
    session.start();

    room.emit(RoomEvent.TrackSubscribed, audioTrack, {}, person("u-sam", "Sam"));

    await vi.waitFor(() => expect(order).toContain("ended:invalid-key"), {
      timeout: 10_000,
    });
  });

  it("is safe to stop twice and runs the shutdown once", async () => {
    const { session, disconnect } = await makeSession();
    session.start();

    await Promise.all([session.stop("budget"), session.stop("shutdown")]);

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("reports usage on a timer while running, and keeps entries the API did not store", async () => {
    vi.useFakeTimers();
    const harness = fakeClient();
    const postUsage = harness.client.postUsage as unknown as ReturnType<typeof vi.fn>;
    postUsage.mockResolvedValueOnce(false).mockResolvedValue(true);
    const room = new FakeRoom();
    const session = new MeetingSession(room as unknown as RoomLike, redeemed(), {
      vad: await loadRealVad(),
      client: harness.client,
      clock: frameClock(),
      openFrames: () => ({ frames: paced([]), close: async () => undefined }),
      disconnect: vi.fn(),
    });
    session.start();
    (session as unknown as { usage: UsageIn[] }).usage.push({
      feature: "transcription",
      model: "fake",
      audioSeconds: 2,
      latencyMs: 100,
      status: "OK",
    });

    await vi.advanceTimersByTimeAsync(USAGE_INTERVAL_MS + 1);
    await vi.advanceTimersByTimeAsync(USAGE_INTERVAL_MS + 1);

    expect(postUsage).toHaveBeenCalledTimes(2);
    expect(postUsage.mock.calls[1]![0]).toHaveLength(1);
    await session.stop("shutdown");
  });
});
