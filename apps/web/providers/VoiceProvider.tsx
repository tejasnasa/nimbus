/**
 * @module web/providers/VoiceProvider
 * @description Owns the workspace call. Wraps a `livekit-client` `Room`, so the
 * provider (not a component) controls its lifecycle: `join()` fetches a token
 * and connects with the microphone off, `leave()` disconnects, and the room is
 * also dropped on unmount and on `pagehide`. State exposed through context is
 * a projection of room events: connection state, mute and deafen flags, the
 * participant list, and who is speaking.
 *
 * Before the user joins, `voiceUsers` is the server's roster (`voice:roster`,
 * seeded from the server-rendered page); once connected it is read from the
 * room, so it reflects joins and leaves as they happen.
 *
 * @important The context carries the live `room` so later features can use its
 *            data channel and RPC. Nothing outside this provider should call
 *            `room.connect` or `room.disconnect`; go through `join`/`leave` so
 *            the state here cannot drift from the room.
 *
 * @important Remote audio is played by a hidden `RoomAudioRenderer` mounted in
 *            this provider. Deafening sets its `muted` flag, which also covers
 *            tracks that arrive after the user deafened, so there is no
 *            per-track bookkeeping to keep in step.
 *
 * @important A failed connection or a lost one never throws into React. It
 *            becomes `error` (a curated message) and, for an unexpected drop,
 *            `canRejoin`, which the UI offers as a Rejoin button once LiveKit's
 *            own reconnection attempts are exhausted.
 */
"use client";

import { RoomAudioRenderer } from "@livekit/components-react";
import { VoiceUser } from "@nimbus/types";
import {
  ConnectionState,
  DisconnectReason,
  Participant,
  ParticipantKind,
  Room,
  RoomEvent,
} from "livekit-client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { socket } from "../lib/socket";
import { fetchVoiceToken } from "../lib/voiceApi";

/** Shown when the browser refuses microphone access. */
export const MIC_DENIED_MESSAGE =
  "Microphone access is blocked. Allow it in your browser's site settings, then try unmuting again.";

/** Shown when the microphone cannot be opened for any other reason. */
export const MIC_FAILED_MESSAGE =
  "Couldn't turn on your microphone. Check that one is connected and not in use by another app.";

/** Shown when the call is lost without the user leaving it. */
export const CONNECTION_LOST_MESSAGE =
  "You were disconnected from the call.";

/** Shown when the media server cannot be reached while joining. */
export const JOIN_FAILED_MESSAGE =
  "Couldn't connect to the call. Check your connection and try again.";

/** Someone in the room, as the UI renders them. */
export interface VoiceParticipant {
  userId: string;
  name: string;
  image: string | null;
  /** Whether their microphone is off (or not yet published). */
  isMuted: boolean;
  /** Whether this is the assistant rather than a person. */
  isAgent: boolean;
  isLocal: boolean;
}

/** Voice state + controls consumed via `useVoice()`. */
interface VoiceContextType {
  isConnected: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  voiceUsers: VoiceUser[];
  speakingUsers: Set<string>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  localUser: { userId: string; name: string; image: string | null };
  join: () => Promise<void>;
  leave: () => void;
  isJoining: boolean;
  connectionState: ConnectionState;
  /** The live room, for features that use its data channel or RPC. */
  room: Room;
  /** Everyone in the room right now, agents included. Empty when not joined. */
  participants: VoiceParticipant[];
  /** A message safe to show the user, or null. */
  error: string | null;
  /** The call dropped unexpectedly and the user can try to get back in. */
  canRejoin: boolean;
}

const VoiceContext = createContext<VoiceContextType | null>(null);

/**
 * Reads voice state; throws outside `VoiceProvider` to fail fast on
 * misplaced consumers.
 */
export function useVoice() {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error("useVoice must be used within a VoiceProvider");
  }
  return context;
}

/** Reads the avatar the token carried in the participant's metadata. */
function imageFromMetadata(metadata: string | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { image?: unknown };
    return typeof parsed.image === "string" ? parsed.image : null;
  } catch {
    return null;
  }
}

/** Projects a LiveKit participant onto the shape the UI renders. */
function toParticipant(participant: Participant, isLocal: boolean) {
  return {
    userId: participant.identity,
    name: participant.name || participant.identity,
    image: imageFromMetadata(participant.metadata),
    isMuted: !participant.isMicrophoneEnabled,
    isAgent: participant.kind === ParticipantKind.AGENT,
    isLocal,
  } satisfies VoiceParticipant;
}

/** Whether a rejected `setMicrophoneEnabled` was the browser refusing access. */
function isPermissionDenied(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  return (
    e?.name === "NotAllowedError" ||
    e?.name === "PermissionDeniedError" ||
    /permission|not allowed|denied/i.test(e?.message ?? "")
  );
}

interface VoiceProviderProps {
  children: React.ReactNode;
  userId: string;
  userName: string;
  userImage: string | null;
  workspaceId: string;
  /** The roster as rendered by the server, shown until the first update. */
  initialRoster?: VoiceUser[];
}

/**
 * Creates the room for the workspace and publishes its state via context.
 *
 * @param props - Identity + workspace, an optional server-rendered roster, and
 *                children.
 */
export function VoiceProvider({
  children,
  userId,
  userName,
  userImage,
  workspaceId,
  initialRoster = [],
}: VoiceProviderProps) {
  const [room] = useState(
    () =>
      new Room({
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
  );

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected,
  );
  const [isJoining, setIsJoining] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isDeafened, setIsDeafened] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());
  const [roster, setRoster] = useState<VoiceUser[]>(initialRoster);
  const [error, setError] = useState<string | null>(null);
  const [canRejoin, setCanRejoin] = useState(false);

  // Mirrors for use inside room callbacks, which are registered once.
  const isDeafenedRef = useRef(false);
  const mutedBeforeDeafen = useRef(true);
  // Set while the user is leaving, so the resulting disconnect is not mistaken
  // for a dropped call. The attempt counter lets a `leave()` that lands while a
  // join is still fetching its token cancel that join.
  const leavingRef = useRef(false);
  const joinAttempt = useRef(0);

  /** Copies the room's participants and local mic state into React state. */
  const refresh = useCallback(() => {
    const local = room.localParticipant;
    setParticipants([
      toParticipant(local, true),
      ...[...room.remoteParticipants.values()].map((p) =>
        toParticipant(p, false),
      ),
    ]);
    setIsMuted(!local.isMicrophoneEnabled);
  }, [room]);

  /** Resets everything that only means something while in a call. */
  const clearCallState = useCallback(() => {
    setParticipants([]);
    setSpeakingUsers(new Set());
    setIsMuted(true);
    setIsDeafened(false);
    isDeafenedRef.current = false;
    mutedBeforeDeafen.current = true;
  }, []);

  useEffect(() => {
    const onParticipantsChanged = () => refresh();
    const onReconnecting = () => setConnectionState(ConnectionState.Reconnecting);
    const onReconnected = () => {
      setConnectionState(ConnectionState.Connected);
      refresh();
    };
    const onActiveSpeakers = (speakers: Participant[]) =>
      setSpeakingUsers(new Set(speakers.map((s) => s.identity)));
    const onDisconnected = (reason?: DisconnectReason) => {
      setConnectionState(ConnectionState.Disconnected);
      clearCallState();
      const initiatedHere =
        leavingRef.current || reason === DisconnectReason.CLIENT_INITIATED;
      leavingRef.current = false;
      if (!initiatedHere) {
        setError(CONNECTION_LOST_MESSAGE);
        setCanRejoin(true);
      }
    };

    const refreshEvents = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantMetadataChanged,
      RoomEvent.ParticipantNameChanged,
    ] as const;

    refreshEvents.forEach((event) => room.on(event, onParticipantsChanged));
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
    room.on(RoomEvent.Disconnected, onDisconnected);

    return () => {
      refreshEvents.forEach((event) => room.off(event, onParticipantsChanged));
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room, refresh, clearCallState]);

  // The server's roster, for the "who is on the call" view before joining.
  useEffect(() => {
    const onRoster = (data: { users: VoiceUser[] }) => setRoster(data.users);
    socket.on("voice:roster", onRoster);
    return () => {
      socket.off("voice:roster", onRoster);
    };
  }, []);

  // Leave when the provider goes away or the page is being closed, so a closed
  // tab does not hold a seat on the call until the media server times it out.
  useEffect(() => {
    const drop = () => {
      leavingRef.current = true;
      void room.disconnect();
    };
    window.addEventListener("pagehide", drop);
    return () => {
      window.removeEventListener("pagehide", drop);
      drop();
    };
  }, [room]);

  const join = useCallback(async () => {
    if (isJoining || room.state !== ConnectionState.Disconnected) return;

    const attempt = ++joinAttempt.current;
    setIsJoining(true);
    setError(null);
    setCanRejoin(false);
    leavingRef.current = false;

    try {
      const result = await fetchVoiceToken(workspaceId);
      if (attempt !== joinAttempt.current) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }

      await room.connect(result.url, result.token);
      if (attempt !== joinAttempt.current) {
        // Left while connecting: undo rather than surface a call nobody wants.
        leavingRef.current = true;
        await room.disconnect();
        return;
      }

      // Joining is a user gesture, which is what lets the browser start
      // playback; a refusal here is not fatal (the renderer retries on demand).
      await room.startAudio().catch(() => {});
      setConnectionState(ConnectionState.Connected);
      refresh();
    } catch {
      if (attempt === joinAttempt.current) {
        setConnectionState(ConnectionState.Disconnected);
        setError(JOIN_FAILED_MESSAGE);
      }
    } finally {
      if (attempt === joinAttempt.current) setIsJoining(false);
    }
  }, [isJoining, room, workspaceId, refresh]);

  const leave = useCallback(() => {
    joinAttempt.current++;
    leavingRef.current = true;
    setIsJoining(false);
    setError(null);
    setCanRejoin(false);
    void room.disconnect();
  }, [room]);

  /** Turns the microphone on or off, reporting a refusal as `error`. */
  const setMicrophone = useCallback(
    async (enabled: boolean) => {
      try {
        await room.localParticipant.setMicrophoneEnabled(enabled);
        setError(null);
        refresh();
        return true;
      } catch (err) {
        setError(isPermissionDenied(err) ? MIC_DENIED_MESSAGE : MIC_FAILED_MESSAGE);
        refresh();
        return false;
      }
    },
    [room, refresh],
  );

  const toggleMute = useCallback(() => {
    if (room.state !== ConnectionState.Connected) return;
    const wantMicOn = !room.localParticipant.isMicrophoneEnabled;

    // Unmuting while deafened also undeafens: hearing nothing while talking
    // is never what the user meant.
    if (wantMicOn && isDeafenedRef.current) {
      isDeafenedRef.current = false;
      setIsDeafened(false);
    }
    void setMicrophone(wantMicOn);
  }, [room, setMicrophone]);

  const toggleDeafen = useCallback(() => {
    if (room.state !== ConnectionState.Connected) return;

    if (!isDeafenedRef.current) {
      // Deafening silences the user too, and remembers whether to restore them.
      mutedBeforeDeafen.current = !room.localParticipant.isMicrophoneEnabled;
      isDeafenedRef.current = true;
      setIsDeafened(true);
      if (!mutedBeforeDeafen.current) void setMicrophone(false);
    } else {
      isDeafenedRef.current = false;
      setIsDeafened(false);
      if (!mutedBeforeDeafen.current) void setMicrophone(true);
    }
  }, [room, setMicrophone]);

  const voiceUsers = useMemo<VoiceUser[]>(() => {
    if (connectionState === ConnectionState.Disconnected) return roster;
    return participants
      .filter((p) => !p.isAgent)
      .map(({ userId: id, name, image }) => ({ userId: id, name, image }));
  }, [connectionState, participants, roster]);

  const value = useMemo<VoiceContextType>(
    () => ({
      isConnected: connectionState === ConnectionState.Connected,
      isMuted,
      isDeafened,
      voiceUsers,
      speakingUsers,
      toggleMute,
      toggleDeafen,
      localUser: { userId, name: userName, image: userImage },
      join,
      leave,
      isJoining,
      connectionState,
      room,
      participants,
      error,
      canRejoin,
    }),
    [
      connectionState,
      isMuted,
      isDeafened,
      voiceUsers,
      speakingUsers,
      toggleMute,
      toggleDeafen,
      userId,
      userName,
      userImage,
      join,
      leave,
      isJoining,
      room,
      participants,
      error,
      canRejoin,
    ],
  );

  return (
    <VoiceContext.Provider value={value}>
      <RoomAudioRenderer room={room} muted={isDeafened} />
      {children}
    </VoiceContext.Provider>
  );
}
