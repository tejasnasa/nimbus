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
import { ClientDocument } from "../api/document";
import { useVoice } from "../providers/VoiceProvider";
import WorkspaceSettings from "./WorkspaceSettings";

export default function VoiceControls({
  documents,
  workspaceData,
}: {
  documents: ClientDocument[];
  workspaceData: Workspace;
}) {
  const {
    isConnected,
    isMuted,
    isDeafened,
    voiceUsers,
    speakingUsers,
    toggleMute,
    toggleDeafen,
  } = useVoice();

  if (!isConnected) {
    return (
      <div className="flex items-center justify-between p-4 py-6 bg-(--card) backdrop-blur-sm border-b border-(--border) mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-semibold text-(--muted-foreground)">
            Voice Connecting...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 bg-(--card) backdrop-blur-sm border-b border-(--border) mb-3 transition-all duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-(--chart-2) animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          {/* <span className="text-xs font-semibold text-(--foreground)">
            Voice
          </span> */}
          <AvatarGroup
            users={voiceUsers.map((user) => {
              return {
                image: user.image || getAvatarForUser(user.userId),
              };
            })}
            max={4}
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleMute}
            className={`p-2 rounded-lg transition-all duration-200 hover:cursor-pointer flex items-center justify-center ${
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
            className={`p-2 rounded-lg transition-all duration-200 hover:cursor-pointer flex items-center justify-center ${
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

          <AlertDialog
            trigger={
              <button className="p-2 w-9 h-9 hover:cursor-pointer rounded-lg hover:bg-(--muted) transition-all duration-200 hover:text-(--foreground) shrink-0">
                <Settings />
              </button>
            }
          >
            <WorkspaceSettings
              workspace={workspaceData}
              documents={documents}
            />
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
