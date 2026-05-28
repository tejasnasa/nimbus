"use client";

import Headphones from "@nimbus/ui/icons/Headphones";
import HeadphonesOff from "@nimbus/ui/icons/HeadphonesOff";
import Microphone from "@nimbus/ui/icons/Microphone";
import MicrophoneOff from "@nimbus/ui/icons/MicrophoneOff";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { useVoice } from "../providers/VoiceProvider";

export default function VoiceControls() {
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
      <div className="flex items-center justify-between p-3.5 bg-(--muted)/20 backdrop-blur-sm border border-(--border) rounded-xl mb-3">
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
    <div className="flex flex-col gap-3 p-3.5 bg-(--muted)/20 backdrop-blur-sm border border-(--border) rounded-xl mb-3 transition-all duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          <span className="text-xs font-semibold text-(--foreground)">
            Voice Connected
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleMute}
            className={`p-2 rounded-lg transition-all duration-200 hover:cursor-pointer flex items-center justify-center ${
              isMuted
                ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                : "bg-(--muted) text-(--foreground) hover:bg-(--muted)/80"
            }`}
            title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
          >
            {isMuted ? (
              <MicrophoneOff className="w-4 h-4" />
            ) : (
              <Microphone className="w-4 h-4" />
            )}
          </button>

          <button
            onClick={toggleDeafen}
            className={`p-2 rounded-lg transition-all duration-200 hover:cursor-pointer flex items-center justify-center ${
              isDeafened
                ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                : "bg-(--muted) text-(--foreground) hover:bg-(--muted)/80"
            }`}
            title={isDeafened ? "Undeafen Audio" : "Deafen Audio"}
          >
            {isDeafened ? (
              <HeadphonesOff className="w-4 h-4" />
            ) : (
              <Headphones className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {voiceUsers.length > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-(--border)/40 max-h-36 overflow-y-auto scrollbar-thin">
          {voiceUsers.map((u) => {
            const isSpeaking = speakingUsers.has(u.userId);
            return (
              <div
                key={u.userId}
                className="flex items-center justify-between text-xs py-0.5"
              >
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <img
                      src={u.image || getAvatarForUser(u.userId)}
                      alt={u.name}
                      className={`w-6 h-6 rounded-full transition-all duration-200 ${
                        isSpeaking
                          ? "ring-2 ring-emerald-500 scale-105"
                          : "ring-1 ring-(--border)"
                      }`}
                    />
                    {isSpeaking && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-500 rounded-full border border-(--background)" />
                    )}
                  </div>
                  <span
                    className={`font-medium truncate max-w-28 transition-colors ${
                      isSpeaking
                        ? "text-emerald-500"
                        : "text-(--muted-foreground)"
                    }`}
                  >
                    {u.name}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-(--muted-foreground)/60">
                  {u.isMuted && (
                    <MicrophoneOff className="w-3.5 h-3.5 text-red-500/80" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
