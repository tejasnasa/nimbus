/**
 * @module web/components/VoiceControls
 * @description Body of the voice call card. Before the user joins it shows who
 * is already on the call (from the server's roster) and a **Join call** button;
 * once in, an overlapping avatar stack of the participants (a green ring while
 * someone speaks, a red dot while they are muted, a badge on the assistant),
 * the mute, deafen and leave controls, the assistant's start and stop control
 * and the running transcript. An error from the provider (a refused
 * microphone, a failed join) is shown inline, and a dropped call offers
 * **Rejoin**. Rendered inside `VoiceDock`.
 */
"use client";

import AvatarGroup from "@nimbus/ui/AvatarGroup";
import Headphones from "@nimbus/ui/icons/Headphones";
import HeadphonesOff from "@nimbus/ui/icons/HeadphonesOff";
import Microphone from "@nimbus/ui/icons/Microphone";
import MicrophoneOff from "@nimbus/ui/icons/MicrophoneOff";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { ConnectionState } from "livekit-client";
import { useVoice } from "../providers/VoiceProvider";
import AssistantButton from "./meeting/AssistantButton";
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
  "px-3 py-1.5 rounded-lg text-xs font-semibold bg-(--primary) text-(--primary-foreground) hover:cursor-pointer hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed";

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
    <p role="alert" className="text-xs text-red-500 leading-snug">
      {error}
    </p>
  ) : null;

  const inCall = connectionState !== ConnectionState.Disconnected;
  const isReconnecting =
    connectionState === ConnectionState.Reconnecting ||
    connectionState === ConnectionState.SignalReconnecting;

  if (!inCall) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {voiceUsers.length > 0 && (
            <AvatarGroup
              users={voiceUsers.map((user) => ({
                image: user.image || getAvatarForUser(user.userId),
              }))}
              max={4}
            />
          )}
          <span
            data-testid="call-roster"
            className="text-xs font-semibold text-(--muted-foreground) truncate"
          >
            {describeRoster(voiceUsers.map((user) => user.name))}
          </span>
        </div>
        <button
          onClick={() => void join()}
          disabled={isJoining}
          className={`${JOIN_BUTTON_CLASS} self-start`}
        >
          {canRejoin ? "Rejoin" : isJoining ? "Joining..." : "Join call"}
        </button>
        {errorMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-2.5 h-2.5 shrink-0 rounded-full animate-pulse ${
              isReconnecting
                ? "bg-amber-500"
                : "bg-(--chart-2) shadow-[0_0_8px_rgba(16,185,129,0.5)]"
            }`}
          />
          {isReconnecting ? (
            <span className="text-xs font-semibold text-(--muted-foreground)">
              Reconnecting...
            </span>
          ) : (
            <ul aria-label="On the call" className="flex items-center">
              {participants.map((participant, i) => (
                <li
                  key={participant.userId}
                  data-testid="call-participant"
                  data-muted={participant.isMuted}
                  title={`${participant.name}${participant.isMuted ? " (muted)" : ""}`}
                  className="relative -ml-3 first:ml-0"
                  style={{ zIndex: participants.length - i }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      participant.image || getAvatarForUser(participant.userId)
                    }
                    alt={participant.name}
                    className={`h-9 w-9 rounded-full border-2 object-cover transition-colors ${
                      speakingUsers.has(participant.userId)
                        ? "border-(--chart-2)"
                        : "border-(--background)"
                    }`}
                  />
                  {participant.isAgent && (
                    <span className="absolute -top-1 -right-1 rounded-full bg-(--primary) px-1 text-[8px] font-semibold uppercase leading-3 text-(--primary-foreground)">
                      Bot
                    </span>
                  )}
                  {participant.isMuted && (
                    <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border-2 border-(--background) bg-red-500">
                      <MicrophoneOff className="h-2 w-2 text-white" />
                      <span className="sr-only">muted</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={toggleMute}
            disabled={isReconnecting}
            className={`p-2 rounded-lg transition-all duration-200 hover:cursor-pointer flex items-center justify-center disabled:opacity-50 ${
              isMuted
                ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                : "text-(--foreground) hover:bg-(--muted)/80"
            }`}
            title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
          >
            {isMuted ? (
              <MicrophoneOff className="w-5 h-5" />
            ) : (
              <Microphone className="w-5 h-5" />
            )}
          </button>

          <button
            onClick={toggleDeafen}
            disabled={isReconnecting}
            className={`p-2 rounded-lg transition-all duration-200 hover:cursor-pointer flex items-center justify-center disabled:opacity-50 ${
              isDeafened
                ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                : "text-(--foreground) hover:bg-(--muted)/80"
            }`}
            title={isDeafened ? "Undeafen Audio" : "Deafen Audio"}
          >
            {isDeafened ? (
              <HeadphonesOff className="w-5 h-5" />
            ) : (
              <Headphones className="w-5 h-5" />
            )}
          </button>

          <button
            onClick={leave}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:cursor-pointer"
            title="Leave call"
            aria-label="Leave call"
          >
            Leave
          </button>
        </div>
      </div>

      <AssistantButton inCall />
      <LiveTranscript />
      {errorMessage}
    </div>
  );
}
