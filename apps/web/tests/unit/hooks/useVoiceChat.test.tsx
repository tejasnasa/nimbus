/**
 * @module web/tests/unit/hooks/useVoiceChat
 * @description Voice-session state machine: TURN credentials → muted mic →
 * `voice:join` → per-peer mesh over a mocked socket, hidden audio playback,
 * speaking indicators driven by a stubbed AnalyserNode, mute/deafen syncing,
 * and full teardown on unmount.
 *
 * WebRTC itself is stubbed — `RTCPeerConnection` only records what the hook asks
 * of it, so these tests assert the signalling and lifecycle contract rather
 * than media flow. The socket singleton is mocked with a small stand-in that can
 * also *deliver* server events, which is what drives the inbound paths.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse, type DefaultBodyType } from "msw";
import { BACKEND_URL, ok } from "../../msw/handlers";
import { server } from "../../msw/server";

type Handler = (payload: never) => void;

const { socketMock } = vi.hoisted(() => {
  const listeners = new Map<string, Set<Handler>>();
  return {
    socketMock: {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: Handler) => {
        const set = listeners.get(event) ?? new Set<Handler>();
        set.add(handler);
        listeners.set(event, set);
      }),
      off: vi.fn((event: string, handler: Handler) => {
        listeners.get(event)?.delete(handler);
      }),
      /** Delivers a server → client event to the hook's handlers. */
      __fire: (event: string, payload?: unknown) => {
        listeners.get(event)?.forEach((handler) => handler(payload as never));
      },
      __reset: () => listeners.clear(),
    },
  };
});

vi.mock("../../../lib/socket", () => ({ socket: socketMock }));

import { useVoiceChat } from "../../../hooks/useVoiceChat";
import type { UseVoiceChatProps } from "../../../hooks/useVoiceChat";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const TURN_URL = `${BACKEND_URL}/api/turn/credentials`;
const WORKSPACE_ID = "ws-1";
const SELF_ID = "user-1";

/**
 * Minimal MediaStream stand-in — the hook only reads tracks off it, and remote
 * streams also have to satisfy the `HTMLMediaElement.srcObject` type check.
 */
const makeStream = (label: string) => {
  const track = {
    kind: "audio" as const,
    label,
    enabled: true,
    stop: vi.fn(),
  };
  const stream = Object.create(MediaStream.prototype) as MediaStream;
  Object.assign(stream, {
    id: label,
    getAudioTracks: () => [track],
    getTracks: () => [track],
  });
  return { track, stream };
};

/** Records what the hook does with a peer, and can simulate remote activity. */
class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  config: RTCConfiguration;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  closed = false;
  addedTracks: MediaStreamTrack[] = [];
  addedCandidates: unknown[] = [];

  constructor(config: RTCConfiguration) {
    this.config = config;
    FakePeerConnection.instances.push(this);
  }

  addTrack = (track: MediaStreamTrack) => {
    this.addedTracks.push(track);
  };

  createOffer = async () => ({ type: "offer", sdp: "offer-sdp" });
  createAnswer = async () => ({ type: "answer", sdp: "answer-sdp" });

  setLocalDescription = async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description;
  };

  setRemoteDescription = async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description;
  };

  addIceCandidate = async (candidate: unknown) => {
    this.addedCandidates.push(candidate);
  };

  close = () => {
    this.closed = true;
  };

  /** Simulates the remote side's media arriving. */
  emitTrack = (stream: MediaStream) => {
    this.ontrack?.({ streams: [stream] });
  };

  emitIceCandidate = (candidate: unknown) => {
    this.onicecandidate?.({ candidate });
  };
}

class FakeAnalyserNode {
  fftSize = 0;
  minDecibels = 0;
  maxDecibels = 0;
  smoothingTimeConstant = 0;
  connect = () => {};
  getByteFrequencyData = (array: Uint8Array) => {
    array.fill(FakeAudioContext.energy);
  };
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static energy = 0;
  closed = false;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource = () => ({ connect: () => {} });
  createAnalyser = () => new FakeAnalyserNode();
  close = () => {
    this.closed = true;
  };
}

const getUserMedia = vi.fn();
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const renderVoice = (overrides: Partial<UseVoiceChatProps> = {}) =>
  renderHook((props: UseVoiceChatProps) => useVoiceChat(props), {
    initialProps: {
      userId: SELF_ID,
      userName: "Ada Lovelace",
      userImage: null,
      workspaceId: WORKSPACE_ID,
      ...overrides,
    } as UseVoiceChatProps,
  });


/** Renders and waits for the TURN + mic + join sequence to finish. */
const connectedVoice = async (overrides: Partial<UseVoiceChatProps> = {}) => {
  const hook = renderVoice(overrides);
  await waitFor(() => expect(hook.result.current.isConnected).toBe(true));
  return hook;
};

/** Delivers a server → client socket event and flushes the resulting work. */
const fireServer = async (event: string, payload?: unknown) => {
  await act(async () => {
    socketMock.__fire(event, payload);
  });
};

const joinEvents = [
  "voice:current-users",
  "voice:user-joined",
  "voice:user-left",
  "voice:offer",
  "voice:answer",
  "voice:ice-candidate",
  "voice:mute-state",
];

describe("useVoiceChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketMock.__reset();
    FakePeerConnection.instances = [];
    FakeAudioContext.instances = [];
    FakeAudioContext.energy = 0;
    document.body.innerHTML = "";

    getUserMedia.mockResolvedValue(makeStream("local").stream);
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    vi.stubGlobal(
      "RTCSessionDescription",
      class {
        constructor(init: Record<string, unknown>) {
          Object.assign(this, init);
        }
      },
    );
    vi.stubGlobal(
      "RTCIceCandidate",
      class {
        constructor(init: Record<string, unknown>) {
          Object.assign(this, init);
        }
      },
    );
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window.navigator, "mediaDevices");
  });

  it("starts disconnected, muted, and with an empty roster", () => {
    const { result } = renderHook(() => useVoiceChat({
      userId: SELF_ID,
      userName: "Ada Lovelace",
      userImage: null,
      workspaceId: WORKSPACE_ID,
    }));

    expect(result.current.isConnected).toBe(false);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.isDeafened).toBe(false);
    expect(result.current.voiceUsers).toEqual([]);
    expect(result.current.speakingUsers.size).toBe(0);
  });

  it("fetches TURN credentials with the session cookie before joining", async () => {
    const requests: Array<{ url: string; credentials?: RequestCredentials }> = [];
    server.use(
      http.get(TURN_URL, ({ request }) => {
        requests.push({
          url: new URL(request.url).pathname,
          credentials: request.credentials,
        });
        return ok({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      }),
    );

    const { result } = await connectedVoice();

    expect(requests).toEqual([
      { url: "/api/turn/credentials", credentials: "include" },
    ]);
    expect(result.current.isConnected).toBe(true);
  });

  it("joins muted: the mic is live but captures nothing", async () => {
    const { track, stream } = makeStream("local");
    getUserMedia.mockResolvedValue(stream);

    const { result } = await connectedVoice();

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(track.enabled).toBe(false);
    expect(result.current.isMuted).toBe(true);
  });

  it("seeds the roster with the current user and only then joins the channel", async () => {
    const { result } = await connectedVoice();

    expect(result.current.voiceUsers).toEqual([
      { userId: SELF_ID, name: "Ada Lovelace", image: null, isMuted: true },
    ]);
    expect(socketMock.emit).toHaveBeenCalledWith("voice:join", WORKSPACE_ID);

    // Joining last matters: the server answers with the roster, which triggers
    // outbound offers, so the mic track has to exist by then.
    const micOrder = getUserMedia.mock.invocationCallOrder[0] ?? 0;
    const joinOrder = socketMock.emit.mock.invocationCallOrder[0] ?? 0;
    expect(micOrder).toBeLessThan(joinOrder);
  });

  it("does not touch the microphone when TURN credentials cannot be fetched", async () => {
    server.use(
      http.get(TURN_URL, () => HttpResponse.json({}, { status: 500 })),
    );

    const { result } = renderVoice();
    await waitFor(() => expect(consoleError).toHaveBeenCalled());

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
    expect(socketMock.emit).not.toHaveBeenCalledWith("voice:join", WORKSPACE_ID);
  });

  it("logs and stays disconnected when the microphone is refused", async () => {
    getUserMedia.mockRejectedValue(new Error("Permission denied"));

    const { result } = renderVoice();
    await waitFor(() => expect(consoleError).toHaveBeenCalled());

    expect(result.current.isConnected).toBe(false);
    expect(socketMock.emit).not.toHaveBeenCalledWith("voice:join", WORKSPACE_ID);
  });

  it("releases the microphone if the component unmounts while the prompt is open", async () => {
    let grantMic: (() => void) | undefined;
    const { stream, track } = makeStream("late");
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grantMic = () => resolve(stream);
        }),
    );

    const { result, unmount } = renderVoice();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    unmount();
    await act(async () => {
      grantMic?.();
    });

    expect(track.stop).toHaveBeenCalled();
    expect(socketMock.emit).not.toHaveBeenCalledWith("voice:join", WORKSPACE_ID);
    expect(result.current.isConnected).toBe(false);
  });

  it("never prompts for the microphone if the TURN response lands after unmount", async () => {
    let releaseTurn: (() => void) | undefined;
    server.use(
      http.get(
        TURN_URL,
        () =>
          new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
            releaseTurn = () => resolve(ok({ iceServers: [] }));
          }),
      ),
    );

    const { unmount } = renderVoice();
    await waitFor(() => expect(releaseTurn).toBeDefined());

    unmount();
    await act(async () => {
      releaseTurn?.();
    });

    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("does nothing at all without a workspace id", async () => {
    const { result } = renderVoice({ workspaceId: "" });
    await act(async () => {});

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
    expect(socketMock.on).not.toHaveBeenCalled();
  });

  it("subscribes to every voice event once connected and unsubscribes on unmount", async () => {
    const { unmount } = await connectedVoice();

    for (const event of joinEvents) {
      expect(socketMock.on).toHaveBeenCalledWith(event, expect.any(Function));
    }

    unmount();

    for (const event of joinEvents) {
      expect(socketMock.off).toHaveBeenCalledWith(event, expect.any(Function));
    }
  });

  it("stops the local tracks and tells the server when the session ends", async () => {
    const { track, stream } = makeStream("local");
    getUserMedia.mockResolvedValue(stream);

    const hook = await connectedVoice();
    hook.unmount();

    expect(socketMock.emit).toHaveBeenCalledWith("voice:leave", WORKSPACE_ID);
    // stop() (not just `enabled = false`) is what releases the hardware.
    expect(track.stop).toHaveBeenCalled();
  });

  it("offers to every participant reported by voice:current-users", async () => {
    await connectedVoice();
    socketMock.emit.mockClear();

    await fireServer("voice:current-users", {
      users: [
        { userId: "user-2", name: "Grace", image: null, isMuted: true },
        { userId: "user-3", name: "Alan", image: null, isMuted: false },
      ],
    });

    await waitFor(() => {
      expect(
        socketMock.emit.mock.calls.filter(([event]) => event === "voice:offer"),
      ).toHaveLength(2);
    });

    const offers = socketMock.emit.mock.calls
      .filter(([event]) => event === "voice:offer")
      .map(([, payload]) => payload as { targetUserId: string; offer: unknown });

    expect(offers.map((o) => o.targetUserId).sort()).toEqual([
      "user-2",
      "user-3",
    ]);
    expect(offers[0]?.offer).toEqual({ type: "offer", sdp: "offer-sdp" });

    // One peer per participant, each sharing the single captured mic track.
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(FakePeerConnection.instances[0]?.addedTracks).toHaveLength(1);
    expect(FakePeerConnection.instances[0]?.localDescription).toEqual({
      type: "offer",
      sdp: "offer-sdp",
    });
  });

  it("keeps the current user first in the roster reported by the server", async () => {
    const { result } = await connectedVoice();

    await fireServer("voice:current-users", {
      users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
    });

    await waitFor(() =>
      expect(result.current.voiceUsers.map((u) => u.userId)).toEqual([
        SELF_ID,
        "user-2",
      ]),
    );
  });

  it("uses the TURN servers handed back with the roster for the peer connections", async () => {
    const iceServers = [
      { urls: "turn:127.0.0.1:3478?transport=udp", username: "1:u", credential: "c" },
    ];
    server.use(http.get(TURN_URL, () => ok({ iceServers })));

    await connectedVoice();
    await fireServer("voice:current-users", {
      users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
    });

    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    expect(FakePeerConnection.instances[0]?.config).toEqual({
      iceServers,
      iceTransportPolicy: "all",
    });
  });

  it("answers an incoming offer and flushes candidates that arrived first", async () => {
    await connectedVoice();
    socketMock.emit.mockClear();

    const earlyCandidate = { candidate: "early", sdpMid: "0" };
    await fireServer("voice:ice-candidate", {
      fromUserId: "user-2",
      candidate: earlyCandidate,
    });

    await fireServer("voice:offer", {
      fromUserId: "user-2",
      offer: { type: "offer", sdp: "remote-offer" },
    });

    await waitFor(() =>
      expect(
        socketMock.emit.mock.calls.some(([event]) => event === "voice:answer"),
      ).toBe(true),
    );

    const peer = FakePeerConnection.instances[0];
    expect(peer?.remoteDescription).toEqual({
      type: "offer",
      sdp: "remote-offer",
    });
    expect(peer?.localDescription).toEqual({
      type: "answer",
      sdp: "answer-sdp",
    });
    expect(peer?.addedCandidates).toEqual([earlyCandidate]);

    const answer = socketMock.emit.mock.calls.find(
      ([event]) => event === "voice:answer",
    )?.[1] as { targetUserId: string; answer: unknown };
    expect(answer.targetUserId).toBe("user-2");
    expect(answer.answer).toEqual({ type: "answer", sdp: "answer-sdp" });
  });

  it("applies an answer to the matching peer and flushes queued candidates", async () => {
    await connectedVoice();
    await fireServer("voice:current-users", {
      users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
    });
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));

    const peer = FakePeerConnection.instances[0];
    const candidate = { candidate: "queued", sdpMid: "0" };
    await fireServer("voice:ice-candidate", {
      fromUserId: "user-2",
      candidate,
    });

    await fireServer("voice:answer", {
      fromUserId: "user-2",
      answer: { type: "answer", sdp: "remote-answer" },
    });

    await waitFor(() =>
      expect(peer?.remoteDescription).toEqual({
        type: "answer",
        sdp: "remote-answer",
      }),
    );
    expect(peer?.addedCandidates).toEqual([candidate]);
  });

  it("passes a candidate straight through once the peer knows its remote description", async () => {
    await connectedVoice();
    await fireServer("voice:current-users", {
      users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
    });
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const peer = FakePeerConnection.instances[0];

    await fireServer("voice:answer", {
      fromUserId: "user-2",
      answer: { type: "answer", sdp: "remote-answer" },
    });
    await fireServer("voice:ice-candidate", {
      fromUserId: "user-2",
      candidate: { candidate: "later", sdpMid: "0" },
    });

    await waitFor(() => expect(peer?.addedCandidates).toHaveLength(1));
  });

  it("ignores an answer from a peer it does not know about", async () => {
    const { result } = await connectedVoice();
    socketMock.emit.mockClear();

    await fireServer("voice:answer", {
      fromUserId: "user-ghost",
      answer: { type: "answer", sdp: "stale" },
    });

    expect(FakePeerConnection.instances).toHaveLength(0);
    expect(result.current.voiceUsers).toEqual([
      { userId: SELF_ID, name: "Ada Lovelace", image: null, isMuted: true },
    ]);
  });

  it("adds a late joiner once, muted until their own state arrives", async () => {
    const { result } = await connectedVoice();

    await fireServer("voice:user-joined", { userId: "user-2", name: "Grace" });
    await fireServer("voice:user-joined", { userId: "user-2", name: "Grace" });

    await waitFor(() => expect(result.current.voiceUsers).toHaveLength(2));
    expect(result.current.voiceUsers[1]).toEqual({
      userId: "user-2",
      name: "Grace",
      image: null,
      isMuted: true,
    });

    await fireServer("voice:mute-state", {
      userId: "user-2",
      isMuted: false,
    });

    await waitFor(() =>
      expect(result.current.voiceUsers[1]?.isMuted).toBe(false),
    );
  });

  it("attaches a hidden audio element for a remote track", async () => {
    await connectedVoice();
    await fireServer("voice:current-users", {
      users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
    });
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));

    const remote = makeStream("remote").stream;
    act(() => {
      FakePeerConnection.instances[0]?.emitTrack(remote);
    });

    const audio = document.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.volume).toBe(1);
    expect(audio?.srcObject).toBe(remote);
    expect(audio?.autoplay).toBe(true);
    expect(audio?.style.display).toBe("none");
  });

  it("keeps a peer's audio silent when it arrives after a deafen", async () => {
    const { result } = await connectedVoice();
    await fireServer("voice:current-users", {
      users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
    });
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));

    act(() => {
      result.current.toggleDeafen();
    });

    act(() => {
      FakePeerConnection.instances[0]?.emitTrack(makeStream("remote").stream);
    });

    expect(document.querySelector("audio")?.volume).toBe(0);
  });

  it("forwards ICE candidates discovered locally to the peer", async () => {
    await connectedVoice();
    await fireServer("voice:current-users", {
      users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
    });
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    socketMock.emit.mockClear();

    act(() => {
      FakePeerConnection.instances[0]?.emitIceCandidate({ candidate: "local-1" });
    });

    expect(socketMock.emit).toHaveBeenCalledWith("voice:ice-candidate", {
      workspaceId: WORKSPACE_ID,
      targetUserId: "user-2",
      candidate: { candidate: "local-1" },
    });
  });

  it("drops the end-of-gathering candidate rather than signalling it", async () => {
    await connectedVoice();
    await fireServer("voice:current-users", {
      users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
    });
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    socketMock.emit.mockClear();

    act(() => {
      FakePeerConnection.instances[0]?.emitIceCandidate(null);
    });

    expect(socketMock.emit).not.toHaveBeenCalled();
  });

  it("tears down the peer, its audio, and its analyser when a user leaves", async () => {
    const { result } = await connectedVoice();
    await fireServer("voice:current-users", {
      users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
    });
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const peer = FakePeerConnection.instances[0];

    act(() => {
      peer?.emitTrack(makeStream("remote").stream);
    });
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    // The remote track gets its own AudioContext (the first one analyses the
    // local mic), and that is the one teardown has to close.
    const remoteAnalysis = FakeAudioContext.instances.at(-1);

    await fireServer("voice:user-left", { userId: "user-2" });

    await waitFor(() => expect(peer?.closed).toBe(true));
    expect(document.querySelectorAll("audio")).toHaveLength(0);
    expect(remoteAnalysis?.closed).toBe(true);
    expect(result.current.voiceUsers.map((u) => u.userId)).toEqual([SELF_ID]);
    expect(result.current.speakingUsers.has("user-2")).toBe(false);
  });

  it("closes the local AudioContext when the session ends", async () => {
    const hook = await connectedVoice();
    const ownAnalysis = FakeAudioContext.instances.at(-1);

    hook.unmount();

    expect(ownAnalysis?.closed).toBe(true);
  });

  it("unmutes the mic and announces the new state", async () => {
    const { track, stream } = makeStream("local");
    getUserMedia.mockResolvedValue(stream);
    const { result } = await connectedVoice();
    socketMock.emit.mockClear();

    act(() => {
      result.current.toggleMute();
    });

    expect(track.enabled).toBe(true);
    expect(result.current.isMuted).toBe(false);
    expect(result.current.voiceUsers[0]?.isMuted).toBe(false);
    expect(socketMock.emit).toHaveBeenCalledWith("voice:mute-state", {
      workspaceId: WORKSPACE_ID,
      isMuted: false,
    });
  });

  it("mutes the mic again on the next toggle", async () => {
    const { track, stream } = makeStream("local");
    getUserMedia.mockResolvedValue(stream);
    const { result } = await connectedVoice();

    act(() => {
      result.current.toggleMute();
    });
    act(() => {
      result.current.toggleMute();
    });

    expect(track.enabled).toBe(false);
    expect(result.current.isMuted).toBe(true);
  });

  it("ignores a mute toggle before the microphone exists", async () => {
    let grantMic: (() => void) | undefined;
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grantMic = () => resolve(makeStream("late").stream);
        }),
    );

    const { result } = renderVoice();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    act(() => {
      result.current.toggleMute();
    });

    expect(socketMock.emit).not.toHaveBeenCalledWith(
      "voice:mute-state",
      expect.anything(),
    );

    await act(async () => {
      grantMic?.();
    });
  });

  it("deafens by muting the mic and silencing remote audio", async () => {
    const { track, stream } = makeStream("local");
    getUserMedia.mockResolvedValue(stream);
    const { result } = await connectedVoice();
    await fireServer("voice:current-users", {
      users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
    });
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    act(() => {
      FakePeerConnection.instances[0]?.emitTrack(makeStream("remote").stream);
    });
    socketMock.emit.mockClear();

    act(() => {
      result.current.toggleDeafen();
    });

    expect(result.current.isDeafened).toBe(true);
    expect(result.current.isMuted).toBe(true);
    expect(track.enabled).toBe(false);
    expect(document.querySelector("audio")?.volume).toBe(0);
    expect(socketMock.emit).toHaveBeenCalledWith("voice:mute-state", {
      workspaceId: WORKSPACE_ID,
      isMuted: true,
    });
  });

  it("undeafening restores the unmuted state that predated the deafen", async () => {
    const { track, stream } = makeStream("local");
    getUserMedia.mockResolvedValue(stream);
    const { result } = await connectedVoice();

    act(() => {
      result.current.toggleMute();
    });
    act(() => {
      result.current.toggleDeafen();
    });
    act(() => {
      result.current.toggleDeafen();
    });

    expect(result.current.isDeafened).toBe(false);
    expect(result.current.isMuted).toBe(false);
    expect(track.enabled).toBe(true);
  });

  it("undeafening keeps the mic muted when it was muted beforehand", async () => {
    const { track, stream } = makeStream("local");
    getUserMedia.mockResolvedValue(stream);
    const { result } = await connectedVoice();

    act(() => {
      result.current.toggleDeafen();
    });
    act(() => {
      result.current.toggleDeafen();
    });

    expect(result.current.isDeafened).toBe(false);
    expect(result.current.isMuted).toBe(true);
    expect(track.enabled).toBe(false);
  });

  it("treats unmuting while deafened as an undeafen in one gesture", async () => {
    const { track, stream } = makeStream("local");
    getUserMedia.mockResolvedValue(stream);
    const { result } = await connectedVoice();
    socketMock.emit.mockClear();

    act(() => {
      result.current.toggleDeafen();
    });
    act(() => {
      result.current.toggleMute();
    });

    expect(result.current.isDeafened).toBe(false);
    expect(result.current.isMuted).toBe(false);
    expect(track.enabled).toBe(true);
    expect(socketMock.emit).toHaveBeenLastCalledWith("voice:mute-state", {
      workspaceId: WORKSPACE_ID,
      isMuted: false,
    });
  });

  it("reveals the speaking indicator for a participant above the energy threshold", async () => {
    const { result } = await connectedVoice();
    await fireServer("voice:current-users", {
      users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
    });
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    act(() => {
      FakePeerConnection.instances[0]?.emitTrack(makeStream("remote").stream);
    });

    FakeAudioContext.energy = 40;
    await waitFor(() =>
      expect(result.current.speakingUsers.has("user-2")).toBe(true),
    );

    FakeAudioContext.energy = 0;
    await waitFor(() =>
      expect(result.current.speakingUsers.has("user-2")).toBe(false),
    );
  });

  it.fails(
    "shows the current user's updated display name in the roster",
    async () => {
      // The session effect captures `userName` without depending on it, so the
      // roster keeps the name from the render that opened the session.
      const hook = await connectedVoice({ userName: "Ada Lovelace" });

      hook.rerender({
        userId: SELF_ID,
        userName: "Ada Byron",
        userImage: null,
        workspaceId: WORKSPACE_ID,
      });

      await fireServer("voice:current-users", {
        users: [{ userId: "user-2", name: "Grace", image: null, isMuted: true }],
      });
      await waitFor(() =>
        expect(hook.result.current.voiceUsers).toHaveLength(2),
      );

      expect(hook.result.current.voiceUsers[0]?.name).toBe("Ada Byron");
    },
  );
});
