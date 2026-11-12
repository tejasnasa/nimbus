/**
 * @module web/tests/components/VoiceProvider
 * @description The call state machine, driven against a fake `Room`: join, mute,
 * deafen, leave, the curated microphone-denied message, reconnection, an
 * unexpected drop with Rejoin, speaking indicators, and the roster before and
 * after joining.
 *
 * `livekit-client` and the audio renderer are replaced, so these tests pin what
 * the provider does with the room's events and what it asks of the room, not
 * LiveKit itself (the end-to-end call is covered by the Playwright suite).
 */
import "./testUtils";
import { act, render, waitFor } from "@testing-library/react";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL, fail } from "../msw/handlers";
import { server } from "../msw/server";

const lk = vi.hoisted(() => {
  const RoomEvent = {
    ParticipantConnected: "participantConnected",
    ParticipantDisconnected: "participantDisconnected",
    TrackMuted: "trackMuted",
    TrackUnmuted: "trackUnmuted",
    TrackPublished: "trackPublished",
    TrackUnpublished: "trackUnpublished",
    TrackSubscribed: "trackSubscribed",
    LocalTrackPublished: "localTrackPublished",
    LocalTrackUnpublished: "localTrackUnpublished",
    ParticipantMetadataChanged: "participantMetadataChanged",
    ParticipantNameChanged: "participantNameChanged",
    Reconnecting: "reconnecting",
    Reconnected: "reconnected",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    Disconnected: "disconnected",
  } as const;
  const ConnectionState = {
    Disconnected: "disconnected",
    Connecting: "connecting",
    Connected: "connected",
    Reconnecting: "reconnecting",
    SignalReconnecting: "signalReconnecting",
  } as const;
  const DisconnectReason = {
    CLIENT_INITIATED: 1,
    PARTICIPANT_REMOVED: 3,
    SERVER_SHUTDOWN: 2,
  } as const;
  const ParticipantKind = { STANDARD: 0, AGENT: 4 } as const;

  type Listener = (...args: unknown[]) => void;

  class FakeParticipant {
    identity: string;
    name: string;
    metadata?: string;
    kind: number = ParticipantKind.STANDARD;
    isMicrophoneEnabled = false;
    setVolume = vi.fn();
    setMicrophoneEnabled = vi.fn(async (enabled: boolean) => {
      this.isMicrophoneEnabled = enabled;
    });
    constructor(identity: string, name: string, metadata?: string) {
      this.identity = identity;
      this.name = name;
      this.metadata = metadata;
    }
  }

  class FakeRoom {
    static instances: FakeRoom[] = [];
    options: unknown;
    state: string = ConnectionState.Disconnected;
    localParticipant = new FakeParticipant("user-1", "Ada Lovelace");
    remoteParticipants = new Map<string, FakeParticipant>();
    listeners = new Map<string, Set<Listener>>();
    connect = vi.fn<(url: string, token: string) => Promise<void>>(async () => {
      this.state = ConnectionState.Connected;
    });
    startAudio = vi.fn(async () => {});
    disconnect = vi.fn(async () => {
      if (this.state === ConnectionState.Disconnected) return;
      this.state = ConnectionState.Disconnected;
      this.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
    });

    constructor(options?: unknown) {
      this.options = options;
      FakeRoom.instances.push(this);
    }
    on(event: string, listener: Listener) {
      const set = this.listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      this.listeners.set(event, set);
      return this;
    }
    off(event: string, listener: Listener) {
      this.listeners.get(event)?.delete(listener);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((listener) => listener(...args));
    }
    addRemote(participant: FakeParticipant) {
      this.remoteParticipants.set(participant.identity, participant);
      this.emit(RoomEvent.ParticipantConnected, participant);
    }
  }

  const rendererProps: { current: Record<string, unknown> } = { current: {} };

  return {
    RoomEvent,
    ConnectionState,
    DisconnectReason,
    ParticipantKind,
    FakeParticipant,
    FakeRoom,
    rendererProps,
  };
});

vi.mock("livekit-client", () => ({
  Room: lk.FakeRoom,
  RoomEvent: lk.RoomEvent,
  ConnectionState: lk.ConnectionState,
  DisconnectReason: lk.DisconnectReason,
  ParticipantKind: lk.ParticipantKind,
}));

vi.mock("@livekit/components-react", () => ({
  RoomAudioRenderer: (props: Record<string, unknown>) => {
    lk.rendererProps.current = props;
    return <div data-testid="audio-renderer" />;
  },
}));

const { socketMock } = vi.hoisted(() => {
  type Handler = (payload: never) => void;
  const listeners = new Map<string, Set<Handler>>();
  return {
    socketMock: {
      on: vi.fn((event: string, handler: Handler) => {
        const set = listeners.get(event) ?? new Set<Handler>();
        set.add(handler);
        listeners.set(event, set);
      }),
      off: vi.fn((event: string, handler: Handler) => {
        listeners.get(event)?.delete(handler);
      }),
      __fire: (event: string, payload?: unknown) => {
        listeners.get(event)?.forEach((handler) => handler(payload as never));
      },
      __reset: () => listeners.clear(),
    },
  };
});

vi.mock("../../lib/socket", () => ({ socket: socketMock }));

import {
  CONNECTION_LOST_MESSAGE,
  JOIN_FAILED_MESSAGE,
  MIC_DENIED_MESSAGE,
  MIC_FAILED_MESSAGE,
  useVoice,
  VoiceProvider,
} from "../../providers/VoiceProvider";

type Voice = ReturnType<typeof useVoice>;

/** Latest context value, captured on every render. */
let latest: Voice;
function Probe() {
  latest = useVoice();
  return null;
}

const room = () => lk.FakeRoom.instances.at(-1)!;

function mount(initialRoster: Voice["voiceUsers"] = []) {
  return render(
    <VoiceProvider
      userId="user-1"
      userName="Ada Lovelace"
      userImage={null}
      workspaceId="cm_workspace_0000000000000"
      initialRoster={initialRoster}
    >
      <Probe />
    </VoiceProvider>,
  );
}

/** Mounts and joins, leaving the provider connected. */
async function mountJoined() {
  const view = mount();
  await act(async () => {
    await latest.join();
  });
  return view;
}

beforeEach(() => {
  lk.FakeRoom.instances = [];
  lk.rendererProps.current = {};
  socketMock.__reset();
});

describe("VoiceProvider: joining", () => {
  it("starts disconnected and muted, with the room created for capture defaults", () => {
    mount();

    expect(latest.isConnected).toBe(false);
    expect(latest.connectionState).toBe("disconnected");
    expect(latest.isMuted).toBe(true);
    expect(latest.isDeafened).toBe(false);
    expect(latest.participants).toEqual([]);
    expect(room().options).toEqual({
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(latest.room).toBe(room());
  });

  it("connects with the token the API issued and stays muted", async () => {
    await mountJoined();

    expect(room().connect).toHaveBeenCalledWith(
      "ws://127.0.0.1:7880",
      "test-call-token",
    );
    expect(latest.isConnected).toBe(true);
    expect(latest.connectionState).toBe("connected");
    expect(latest.isMuted).toBe(true);
    // Joining never opens the microphone: that is where the permission prompt
    // belongs, and it belongs to the first unmute.
    expect(room().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(latest.isJoining).toBe(false);
    expect(latest.error).toBeNull();
  });

  it("starts audio playback as part of the join gesture", async () => {
    await mountJoined();

    expect(room().startAudio).toHaveBeenCalledTimes(1);
  });

  it("reports isJoining while the join is in flight", async () => {
    mount();
    let finish!: () => void;
    room().connect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            room().state = "connected";
            resolve();
          };
        }),
    );

    let joined!: Promise<void>;
    act(() => {
      joined = latest.join();
    });
    await waitFor(() => expect(room().connect).toHaveBeenCalled());
    expect(latest.isJoining).toBe(true);

    await act(async () => {
      finish();
      await joined;
    });
    expect(latest.isJoining).toBe(false);
  });

  it("shows the API's message when a token is refused, and never connects", async () => {
    server.use(
      http.post(`${BACKEND_URL}/api/voice/token`, () =>
        fail(404, "Workspace not found"),
      ),
    );
    mount();

    await act(async () => {
      await latest.join();
    });

    expect(latest.error).toBe("Workspace not found");
    expect(room().connect).not.toHaveBeenCalled();
    expect(latest.connectionState).toBe("disconnected");
  });

  it("shows a curated message when the media server cannot be reached", async () => {
    mount();
    room().connect.mockRejectedValueOnce(new Error("ws://… ECONNREFUSED"));

    await act(async () => {
      await latest.join();
    });

    expect(latest.error).toBe(JOIN_FAILED_MESSAGE);
    expect(latest.error).not.toMatch(/ECONNREFUSED/);
    expect(latest.isConnected).toBe(false);
    expect(latest.isJoining).toBe(false);
  });

  it("ignores a second join while already connected", async () => {
    await mountJoined();

    await act(async () => {
      await latest.join();
    });

    expect(room().connect).toHaveBeenCalledTimes(1);
  });

  it("clears an earlier error when joining again", async () => {
    server.use(
      http.post(`${BACKEND_URL}/api/voice/token`, () => fail(500, "boom"), {
        once: true,
      }),
    );
    mount();
    await act(async () => {
      await latest.join();
    });
    expect(latest.error).toBe("boom");

    await act(async () => {
      await latest.join();
    });

    expect(latest.error).toBeNull();
    expect(latest.isConnected).toBe(true);
  });

  it("drops a join that was cancelled while the token was being fetched", async () => {
    mount();

    let joined!: Promise<void>;
    act(() => {
      joined = latest.join();
      latest.leave();
    });
    await act(async () => {
      await joined;
    });

    expect(room().connect).not.toHaveBeenCalled();
    expect(latest.isConnected).toBe(false);
    expect(latest.isJoining).toBe(false);
  });
});

describe("VoiceProvider: participants and roster", () => {
  it("shows the server's roster before joining, and updates it from the socket", () => {
    mount([{ userId: "user-2", name: "Grace Hopper", image: null }]);
    expect(latest.voiceUsers.map((u) => u.name)).toEqual(["Grace Hopper"]);

    act(() => {
      socketMock.__fire("voice:roster", {
        users: [{ userId: "user-3", name: "Alan Turing", image: null }],
      });
    });

    expect(latest.voiceUsers.map((u) => u.name)).toEqual(["Alan Turing"]);
  });

  it("reads the roster from the room once joined", async () => {
    await mountJoined();

    act(() => {
      room().addRemote(
        new lk.FakeParticipant(
          "user-2",
          "Grace Hopper",
          JSON.stringify({ image: "https://img.test/g.png" }),
        ),
      );
    });

    expect(latest.voiceUsers).toEqual([
      { userId: "user-1", name: "Ada Lovelace", image: null },
      { userId: "user-2", name: "Grace Hopper", image: "https://img.test/g.png" },
    ]);
  });

  it("tells an agent apart by kind, and keeps it out of the people", async () => {
    await mountJoined();
    const agent = new lk.FakeParticipant("nimbus", "A Person Named Nimbus");
    agent.kind = lk.ParticipantKind.AGENT;

    act(() => room().addRemote(agent));

    expect(latest.participants.find((p) => p.userId === "nimbus")?.isAgent).toBe(
      true,
    );
    expect(latest.voiceUsers.map((u) => u.userId)).toEqual(["user-1"]);
  });

  it("names the agent NimbusBot and never shows it as muted", async () => {
    await mountJoined();
    const agent = new lk.FakeParticipant("agent-AJ_x7Qk2", "");
    agent.kind = lk.ParticipantKind.AGENT;

    act(() => room().addRemote(agent));

    const shown = latest.participants.find((p) => p.userId === "agent-AJ_x7Qk2");
    expect(shown?.name).toBe("NimbusBot");
    expect(shown?.isMuted).toBe(false);
  });

  it("does not treat a person as an agent because of their name", async () => {
    await mountJoined();

    act(() => room().addRemote(new lk.FakeParticipant("user-2", "agent")));

    expect(latest.participants.find((p) => p.userId === "user-2")?.isAgent).toBe(
      false,
    );
  });

  it("follows a remote participant's mute state", async () => {
    await mountJoined();
    const grace = new lk.FakeParticipant("user-2", "Grace Hopper");
    act(() => room().addRemote(grace));
    expect(latest.participants.find((p) => p.userId === "user-2")?.isMuted).toBe(
      true,
    );

    grace.isMicrophoneEnabled = true;
    act(() => room().emit(lk.RoomEvent.TrackUnmuted));

    expect(latest.participants.find((p) => p.userId === "user-2")?.isMuted).toBe(
      false,
    );
  });

  it("drops a participant who leaves", async () => {
    await mountJoined();
    act(() => room().addRemote(new lk.FakeParticipant("user-2", "Grace")));

    room().remoteParticipants.delete("user-2");
    act(() => room().emit(lk.RoomEvent.ParticipantDisconnected));

    expect(latest.participants.map((p) => p.userId)).toEqual(["user-1"]);
  });

  it("tolerates unparseable metadata", async () => {
    await mountJoined();

    act(() =>
      room().addRemote(
        new lk.FakeParticipant("user-2", "Grace", "{not json"),
      ),
    );

    expect(latest.participants.find((p) => p.userId === "user-2")?.image).toBeNull();
  });

  it("reports who is speaking from the active speakers event", async () => {
    await mountJoined();
    const grace = new lk.FakeParticipant("user-2", "Grace");

    act(() =>
      room().emit(lk.RoomEvent.ActiveSpeakersChanged, [grace, room().localParticipant]),
    );
    expect([...latest.speakingUsers].sort()).toEqual(["user-1", "user-2"]);

    act(() => room().emit(lk.RoomEvent.ActiveSpeakersChanged, []));
    expect(latest.speakingUsers.size).toBe(0);
  });
});

describe("VoiceProvider: microphone", () => {
  it("unmutes on the first toggle and mutes on the next", async () => {
    await mountJoined();

    await act(async () => latest.toggleMute());
    expect(room().localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(
      true,
    );
    expect(latest.isMuted).toBe(false);

    await act(async () => latest.toggleMute());
    expect(room().localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(
      false,
    );
    expect(latest.isMuted).toBe(true);
  });

  it("explains a refused permission and stays muted", async () => {
    await mountJoined();
    room().localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }),
    );

    await act(async () => latest.toggleMute());

    expect(latest.error).toBe(MIC_DENIED_MESSAGE);
    expect(latest.isMuted).toBe(true);
    expect(latest.isConnected).toBe(true);
  });

  it("gives a different message when the microphone fails for another reason", async () => {
    await mountJoined();
    room().localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      Object.assign(new Error("Requested device not found"), {
        name: "NotFoundError",
      }),
    );

    await act(async () => latest.toggleMute());

    expect(latest.error).toBe(MIC_FAILED_MESSAGE);
    expect(latest.isMuted).toBe(true);
  });

  it("clears the message once the microphone works", async () => {
    await mountJoined();
    room().localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    await act(async () => latest.toggleMute());
    expect(latest.error).toBe(MIC_DENIED_MESSAGE);

    await act(async () => latest.toggleMute());

    expect(latest.error).toBeNull();
    expect(latest.isMuted).toBe(false);
  });

  it("does nothing before the call is joined", async () => {
    mount();

    await act(async () => latest.toggleMute());

    expect(room().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });
});

describe("VoiceProvider: deafen", () => {
  it("silences remote audio through the renderer", async () => {
    await mountJoined();
    expect(lk.rendererProps.current.muted).toBe(false);

    await act(async () => latest.toggleDeafen());
    expect(latest.isDeafened).toBe(true);
    expect(lk.rendererProps.current.muted).toBe(true);
    expect(lk.rendererProps.current.room).toBe(room());

    await act(async () => latest.toggleDeafen());
    expect(latest.isDeafened).toBe(false);
    expect(lk.rendererProps.current.muted).toBe(false);
  });

  it("stays silent for participants who join after deafening", async () => {
    await mountJoined();
    await act(async () => latest.toggleDeafen());

    act(() => room().addRemote(new lk.FakeParticipant("user-2", "Grace")));

    expect(latest.isDeafened).toBe(true);
    expect(lk.rendererProps.current.muted).toBe(true);
  });

  it("mutes a live microphone while deafened and restores it afterwards", async () => {
    await mountJoined();
    await act(async () => latest.toggleMute());
    expect(latest.isMuted).toBe(false);

    await act(async () => latest.toggleDeafen());
    expect(latest.isMuted).toBe(true);

    await act(async () => latest.toggleDeafen());
    expect(latest.isMuted).toBe(false);
  });

  it("leaves an already-muted microphone muted after undeafening", async () => {
    await mountJoined();

    await act(async () => latest.toggleDeafen());
    await act(async () => latest.toggleDeafen());

    expect(latest.isMuted).toBe(true);
    expect(room().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it("undeafens when the user unmutes", async () => {
    await mountJoined();
    await act(async () => latest.toggleDeafen());

    await act(async () => latest.toggleMute());

    expect(latest.isDeafened).toBe(false);
    expect(latest.isMuted).toBe(false);
    expect(lk.rendererProps.current.muted).toBe(false);
  });
});

describe("VoiceProvider: muting Nimbus", () => {
  it("silences the assistant on this device only, including one that joins later", async () => {
    window.localStorage.clear();
    await mountJoined();
    const person = new lk.FakeParticipant("user-2", "Grace Hopper");
    const agent = new lk.FakeParticipant("agent-1", "");
    agent.kind = lk.ParticipantKind.AGENT;
    act(() => {
      room().addRemote(person);
      room().addRemote(agent);
    });
    expect(agent.setVolume).toHaveBeenLastCalledWith(1);

    window.localStorage.setItem(
      "nimbus:captions:user-1",
      JSON.stringify({ muteAssistant: true }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "nimbus:captions:user-1" }));
    await waitFor(() => expect(agent.setVolume).toHaveBeenLastCalledWith(0));

    const later = new lk.FakeParticipant("agent-2", "");
    later.kind = lk.ParticipantKind.AGENT;
    act(() => room().addRemote(later));
    expect(later.setVolume).toHaveBeenLastCalledWith(0);
    act(() => room().emit(lk.RoomEvent.TrackSubscribed));
    expect(agent.setVolume).toHaveBeenLastCalledWith(0);
    expect(person.setVolume).not.toHaveBeenCalled();
    window.localStorage.clear();
  });
});

describe("VoiceProvider: leaving", () => {
  it("disconnects and resets everything, without an error", async () => {
    await mountJoined();
    await act(async () => latest.toggleMute());
    await act(async () => latest.toggleDeafen());

    act(() => latest.leave());

    expect(room().disconnect).toHaveBeenCalled();
    await waitFor(() => expect(latest.connectionState).toBe("disconnected"));
    expect(latest.isConnected).toBe(false);
    expect(latest.isMuted).toBe(true);
    expect(latest.isDeafened).toBe(false);
    expect(latest.participants).toEqual([]);
    expect(latest.error).toBeNull();
    expect(latest.canRejoin).toBe(false);
  });

  it("can join again after leaving", async () => {
    await mountJoined();
    act(() => latest.leave());
    await waitFor(() => expect(latest.connectionState).toBe("disconnected"));

    await act(async () => {
      await latest.join();
    });

    expect(room().connect).toHaveBeenCalledTimes(2);
    expect(latest.isConnected).toBe(true);
  });

  it("leaves the call when the provider unmounts", async () => {
    const view = await mountJoined();
    const connected = room();

    view.unmount();

    expect(connected.disconnect).toHaveBeenCalled();
  });

  it("leaves the call when the page is being closed", async () => {
    await mountJoined();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(room().disconnect).toHaveBeenCalled();
    await waitFor(() => expect(latest.connectionState).toBe("disconnected"));
    expect(latest.canRejoin).toBe(false);
  });
});

describe("VoiceProvider: connection loss", () => {
  it("surfaces reconnecting and then connected again", async () => {
    await mountJoined();

    act(() => room().emit(lk.RoomEvent.Reconnecting));
    expect(latest.connectionState).toBe("reconnecting");
    expect(latest.isConnected).toBe(false);
    // Still in the call as far as the UI is concerned: the roster is the room's.
    expect(latest.participants.length).toBeGreaterThan(0);

    act(() => room().emit(lk.RoomEvent.Reconnected));
    expect(latest.connectionState).toBe("connected");
    expect(latest.isConnected).toBe(true);
  });

  it("offers a rejoin when the call drops unexpectedly", async () => {
    await mountJoined();

    act(() => {
      room().state = "disconnected";
      room().emit(lk.RoomEvent.Disconnected, lk.DisconnectReason.SERVER_SHUTDOWN);
    });

    expect(latest.connectionState).toBe("disconnected");
    expect(latest.canRejoin).toBe(true);
    expect(latest.error).toBe(CONNECTION_LOST_MESSAGE);
    expect(latest.participants).toEqual([]);
  });

  it("rejoins with a fresh token and clears the loss", async () => {
    await mountJoined();
    act(() => {
      room().state = "disconnected";
      room().emit(lk.RoomEvent.Disconnected, lk.DisconnectReason.SERVER_SHUTDOWN);
    });

    await act(async () => {
      await latest.join();
    });

    expect(latest.isConnected).toBe(true);
    expect(latest.canRejoin).toBe(false);
    expect(latest.error).toBeNull();
    expect(room().connect).toHaveBeenCalledTimes(2);
  });

  it("does not mistake a deliberate leave for a drop", async () => {
    await mountJoined();

    act(() => latest.leave());
    await waitFor(() => expect(latest.connectionState).toBe("disconnected"));

    expect(latest.canRejoin).toBe(false);
  });
});

describe("useVoice", () => {
  it("fails fast outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Orphan() {
      useVoice();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(/within a VoiceProvider/);
    spy.mockRestore();
  });
});
