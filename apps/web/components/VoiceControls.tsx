/**
 * @module web/components/VoiceControls
 * @description Body of the voice call card. Before the user joins it shows who
 * is already on the call (from the server's roster) and a **Start meeting**
 * button, or **Join meeting** when someone is already there.
 *
 * Once in, it reads top to bottom: the people on the call (a lime ring while
 * someone speaks, a red dot while they are muted, a badge on the assistant),
 * the assistant's panel (`AssistantPanel`), the running transcript, and a
 * row with the mute, deafen and leave controls. An error from the
 * provider (a refused microphone, a failed join) is shown inline, and a dropped
 * call offers **Rejoin**. Rendered inside `VoiceDock`.
 */
"use client";

import AvatarGroup from "@nimbus/ui/AvatarGroup";
import Headphones from "@nimbus/ui/icons/Headphones";
import HeadphonesOff from "@nimbus/ui/icons/HeadphonesOff";
import Microphone from "@nimbus/ui/icons/Microphone";
import MicrophoneOff from "@nimbus/ui/icons/MicrophoneOff";
import PhoneHangUp from "@nimbus/ui/icons/PhoneHangUp";
import { avatarFor } from "../lib/nimbusAvatar";
import { ConnectionState } from "livekit-client";
import { useVoice } from "../providers/VoiceProvider";
import AssistantPanel from "./meeting/AssistantPanel";
import LiveTranscript from "./meeting/LiveTranscript";

/** Names the people on the call, e.g. "Ada and Grace are on the call". */
function describeRoster(names: string[]): string {
  if (names.length === 0) return "No one is on the call";
  if (names.length === 1) return `${names[0]} is on the call`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are on the call`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are on the call`;
}

/** Shared look of the primary join and rejoin buttons. */
const JOIN_BUTTON_CLASS =
  "min-h-11.5 w-full rounded-xl bg-(--brand) text-[15px] font-semibold text-white transition-colors hover:cursor-pointer hover:bg-(--brand)/90 disabled:cursor-not-allowed disabled:opacity-60";

/** Shared look of the call controls; `off` marks a control switched off. */
function controlClass(off: boolean): string {
  return `grid h-10 flex-1 place-items-center rounded-[10px] transition-colors hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
    off
      ? "bg-red-500/18 text-red-300 hover:bg-red-500/25"
      : "bg-(--surface-4) text-(--foreground) hover:bg-(--surface-4)/70"
  }`;
}

/** Call card body; reads all of its state from `useVoice()`. */
export default function VoiceControls() {
  const {
    isMuted,
    isDeafened,
    voiceUsers,
    speakingUsers,
    participants,
    toggleMute,
    toggleDeafen,
    join,
    leave,
    isJoining,
    connectionState,
    error,
    canRejoin,
  } = useVoice();

  const errorMessage = error ? (
    <p role="alert" className="text-xs leading-snug text-red-400">
      {error}
    </p>
  ) : null;

  const inCall = connectionState !== ConnectionState.Disconnected;
  const isReconnecting =
    connectionState === ConnectionState.Reconnecting ||
    connectionState === ConnectionState.SignalReconnecting;

  if (!inCall) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2.5 py-4 text-center">
          {voiceUsers.length > 0 ? (
            <AvatarGroup
              users={voiceUsers.map((user) => ({
                image: avatarFor(user.userId, user.image),
              }))}
              max={4}
            />
          ) : (
            <span className="grid size-13 place-items-center rounded-2xl bg-(--surface-4) text-(--violet)">
              <Microphone className="size-6" />
            </span>
          )}
          <span
            data-testid="call-roster"
            className="text-sm text-(--text-body)"
          >
            {describeRoster(voiceUsers.map((user) => user.name))}
          </span>
        </div>
        <button
          onClick={() => void join()}
          disabled={isJoining}
          className={JOIN_BUTTON_CLASS}
        >
          {canRejoin
            ? "Rejoin"
            : isJoining
              ? "Joining..."
              : voiceUsers.length > 0
                ? "Join meeting"
                : "Start meeting"}
        </button>
        {errorMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {isReconnecting ? (
        <p className="flex items-center gap-2 text-xs font-semibold text-(--muted-foreground)">
          <span className="h-2 w-2 animate-pulse rounded-full bg-(--amber) motion-reduce:animate-none" />
          Reconnecting...
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2.5">
          <ul
            aria-label="On the call"
            className="flex flex-wrap items-start gap-2.5"
          >
            {participants.map((participant) => (
              <li
                key={participant.userId}
                data-testid="call-participant"
                data-muted={participant.isMuted}
                title={`${participant.name}${participant.isMuted ? " (muted)" : ""}`}
                className="relative flex w-12 flex-col items-center gap-1"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarFor(
                    participant.userId,
                    participant.image,
                    participant.isAgent,
                  )}
                  alt={participant.name}
                  className={`size-11 rounded-[13px] object-cover transition-shadow duration-300 ${
                    speakingUsers.has(participant.userId)
                      ? "ring-2 ring-(--lime)"
                      : "ring-1 ring-(--line-2)"
                  }`}
                />
                <span className="w-full truncate text-center text-[11px] text-(--muted-foreground)">
                  {participant.name.split(" ")[0]}
                </span>
                {participant.isAgent && (
                  <span className="absolute -top-1 -right-1 rounded-full bg-(--lime) px-1 text-[8px] font-semibold uppercase leading-3 text-(--ink)">
                    Bot
                  </span>
                )}
                {participant.isMuted && (
                  <span className="absolute top-7 right-0 grid size-4 place-items-center rounded-full border-2 border-(--surface-2) bg-red-500">
                    <MicrophoneOff className="h-2 w-2 text-white" />
                    <span className="sr-only">muted</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <span className="truncate text-xs text-(--muted-foreground)">
            {participants.length === 1
              ? "Just you"
              : `${participants.length} on the call`}
          </span>
        </div>
      )}

      <AssistantPanel inCall />
      <LiveTranscript />
      {errorMessage}

      <div className="flex items-center gap-2">
        <button
          onClick={toggleMute}
          disabled={isReconnecting}
          className={controlClass(isMuted)}
          title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
          aria-label={isMuted ? "Unmute Microphone" : "Mute Microphone"}
        >
          {isMuted ? (
            <MicrophoneOff className="h-5 w-5" />
          ) : (
            <Microphone className="h-5 w-5" />
          )}
        </button>
        <button
          onClick={toggleDeafen}
          disabled={isReconnecting}
          className={controlClass(isDeafened)}
          title={isDeafened ? "Undeafen Audio" : "Deafen Audio"}
          aria-label={isDeafened ? "Undeafen Audio" : "Deafen Audio"}
        >
          {isDeafened ? (
            <HeadphonesOff className="h-5 w-5" />
          ) : (
            <Headphones className="h-5 w-5" />
          )}
        </button>
        <button
          onClick={leave}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-red-500/18 px-3 text-[13px] font-semibold text-red-300 transition-colors hover:cursor-pointer hover:bg-red-500/28"
          title="Leave call"
          aria-label="Leave call"
        >
          <PhoneHangUp className="h-4 w-4" />
          Leave
        </button>
      </div>
    </div>
  );
}
