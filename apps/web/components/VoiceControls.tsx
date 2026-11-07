/**
 * @module web/components/VoiceControls
 * @description Call header inside Chat. Before the user joins it shows who is
 * already on the call (from the server's roster) and a **Join call** button;
 * once in, it shows the participants with their mute state and the mute,
 * deafen and leave controls. An error from the provider (a refused microphone,
 * a failed join) is shown inline, and a dropped call offers **Rejoin**. The
 * settings gear opening `WorkspaceSettings` in an `AlertDialog` is available in
 * every state. Rendered at the top of the chat panel.
 */
"use client";

import { Workspace } from "@nimbus/types";
import AlertDialog from "@nimbus/ui/AlertDialog";
import AvatarGroup from "@nimbus/ui/AvatarGroup";
import Headphones from "@nimbus/ui/icons/Headphones";
import HeadphonesOff from "@nimbus/ui/icons/HeadphonesOff";
import Microphone from "@nimbus/ui/icons/Microphone";
import MicrophoneOff from "@nimbus/ui/icons/MicrophoneOff";
import Settings from "@nimbus/ui/icons/Settings";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { ConnectionState } from "livekit-client";
import { ClientDocument } from "../api/document";
import { useVoice } from "../providers/VoiceProvider";
import WorkspaceSettings from "./WorkspaceSettings";

/** Names the people on the call, e.g. "Ada and Grace are on the call". */
function describeRoster(names: string[]): string {
  if (names.length === 0) return "No one is on the call";
  if (names.length === 1) return `${names[0]} is on the call`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are on the call`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are on the call`;
}

/**
 * @param props.documents - Workspace docs (forwarded to settings).
 * @param props.workspaceData - Workspace (forwarded to settings).
 */
export default function VoiceControls({
  documents,
  workspaceData,
}: {
  documents: ClientDocument[];
  workspaceData: Workspace;
}) {
  const {
    isMuted,
    isDeafened,
    voiceUsers,
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

  const settingsTrigger = (
    <AlertDialog
      trigger={
        <button
          title="Workspace settings"
          className="p-2 w-9 h-9 hover:cursor-pointer rounded-lg hover:bg-(--muted) transition-all duration-200 hover:text-(--foreground) shrink-0"
        >
          <Settings />
        </button>
      }
    >
      <WorkspaceSettings workspace={workspaceData} documents={documents} />
    </AlertDialog>
  );

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
      <div className="flex flex-col gap-2 p-4 bg-(--card) backdrop-blur-sm border-b border-(--border) mb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {voiceUsers.length > 0 && (
              <AvatarGroup
                users={voiceUsers.map((user) => ({
                  image: user.image || getAvatarForUser(user.userId),
                }))}
                max={3}
              />
            )}
            <span
              data-testid="call-roster"
              className="text-xs font-semibold text-(--muted-foreground) truncate"
            >
              {describeRoster(voiceUsers.map((user) => user.name))}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {canRejoin && (
              <button
                onClick={() => void join()}
                disabled={isJoining}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-(--primary) text-(--primary-foreground) hover:cursor-pointer hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Rejoin
              </button>
            )}
            {!canRejoin && (
              <button
                onClick={() => void join()}
                disabled={isJoining}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-(--primary) text-(--primary-foreground) hover:cursor-pointer hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isJoining ? "Joining..." : "Join call"}
              </button>
            )}
            {settingsTrigger}
          </div>
        </div>
        {errorMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 bg-(--card) backdrop-blur-sm border-b border-(--border) mb-3 transition-all duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full animate-pulse ${
              isReconnecting
                ? "bg-amber-500"
                : "bg-(--chart-2) shadow-[0_0_8px_rgba(16,185,129,0.5)]"
            }`}
          />
          <span className="text-xs font-semibold text-(--muted-foreground)">
            {isReconnecting ? "Reconnecting..." : "On the call"}
          </span>
        </div>
        <div className="flex items-center gap-1">
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

          {settingsTrigger}
        </div>
      </div>

      {participants.length > 0 && (
        <ul aria-label="On the call" className="flex flex-wrap gap-1.5">
          {participants.map((participant) => (
            <li
              key={participant.userId}
              data-testid="call-participant"
              data-muted={participant.isMuted}
              className="flex items-center gap-1.5 rounded-full bg-(--muted)/60 pl-1 pr-2 py-0.5 text-xs"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={participant.image || getAvatarForUser(participant.userId)}
                alt=""
                className="h-5 w-5 rounded-full object-cover"
              />
              <span>{participant.name}</span>
              {participant.isAgent && (
                <span className="rounded bg-(--primary)/15 px-1 text-[10px] font-semibold uppercase text-(--primary)">
                  Agent
                </span>
              )}
              {participant.isMuted && (
                <>
                  <MicrophoneOff className="h-3.5 w-3.5 text-red-500" />
                  <span className="sr-only">muted</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {errorMessage}
    </div>
  );
}
