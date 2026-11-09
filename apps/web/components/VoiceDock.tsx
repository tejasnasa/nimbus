/**
 * @module web/components/VoiceDock
 * @description Floating voice call entry point in the bottom-right corner of
 * the workspace. Collapsed, it is a small pill ("Join voice call", or "In voice
 * call" with the mute state once joined); opening it reveals the full call card
 * (`VoiceControls`). Opening and closing the card never joins or leaves the
 * call, so it can be tucked away mid-call.
 */
"use client";

import CaretDown from "@nimbus/ui/icons/CaretDown";
import Headphones from "@nimbus/ui/icons/Headphones";
import MicrophoneOff from "@nimbus/ui/icons/MicrophoneOff";
import { ConnectionState } from "livekit-client";
import { useState } from "react";
import { useVoice } from "../providers/VoiceProvider";
import VoiceControls from "./VoiceControls";

/** Floating pill that expands into the voice call card. */
export default function VoiceDock() {
  const [open, setOpen] = useState(false);
  const { connectionState, isMuted, voiceUsers } = useVoice();
  const inCall = connectionState !== ConnectionState.Disconnected;

  return (
    <div className="fixed bottom-20 right-6 z-40 flex flex-col items-end gap-2">
      {open && (
        <section
          aria-label="Voice call"
          data-testid="voice-card"
          className="w-80 rounded-2xl border border-(--border) bg-(--card)/95 p-4 shadow-2xl shadow-(--primary)/10 backdrop-blur-md animate-fade-in"
        >
          <header className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Voice call</h2>
            <button
              type="button"
              aria-label="Hide voice call"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-(--muted-foreground) hover:cursor-pointer hover:bg-(--muted) hover:text-(--foreground)"
            >
              <CaretDown className="h-4 w-4" />
            </button>
          </header>
          <VoiceControls />
        </section>
      )}

      {!open && (
        <button
          type="button"
          data-testid="voice-dock-toggle"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-(--border) bg-(--card)/95 px-3.5 py-2 text-xs font-semibold shadow-lg backdrop-blur-md hover:cursor-pointer hover:border-(--primary)/40"
        >
          {inCall ? (
            <>
              <span className="h-2 w-2 rounded-full bg-(--chart-2) shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              In voice call
              {isMuted && (
                <>
                  <MicrophoneOff className="h-3.5 w-3.5 text-red-500" />
                  <span className="sr-only">muted</span>
                </>
              )}
            </>
          ) : (
            <>
              <Headphones className="h-3.5 w-3.5" />
              Join voice call
              {voiceUsers.length > 0 && (
                <span className="rounded-full bg-(--chart-2)/15 px-1.5 text-[10px] text-(--chart-2)">
                  {voiceUsers.length}
                </span>
              )}
            </>
          )}
        </button>
      )}
    </div>
  );
}
