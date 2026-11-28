/**
 * @module web/components/VoiceDock
 * @description Floating call entry point in the bottom-right corner of the
 * workspace. The call is presented as a meeting: collapsed, the pill reads
 * "Start meeting" when nobody is on the call and "Join meeting" (with the head
 * count) when someone is, and "In meeting" with the mute state once joined.
 * Opening it reveals the full call card (`VoiceControls`). Opening and closing
 * the card never joins or leaves the call, so it can be tucked away mid-call.
 *
 * The card header reads "Meeting" before the call and "In meeting" (with a live
 * dot) during it, and carries an "Open meetings" button that opens the workspace
 * settings on the Meetings tab, where past meetings, notes and action items
 * live. It is offered only where a settings dialog exists to open.
 */
"use client";

import CaretDown from "@nimbus/ui/icons/CaretDown";
import Headphones from "@nimbus/ui/icons/Headphones";
import MicrophoneOff from "@nimbus/ui/icons/MicrophoneOff";
import { ConnectionState } from "livekit-client";
import { useState } from "react";
import { useVoice } from "../providers/VoiceProvider";
import VoiceControls from "./VoiceControls";
import { useOptionalWorkspaceSettings } from "./WorkspaceSettingsContext";

/** Floating pill that expands into the voice call card. */
export default function VoiceDock() {
  const [open, setOpen] = useState(false);
  const { connectionState, isMuted, voiceUsers } = useVoice();
  const settings = useOptionalWorkspaceSettings();
  const inCall = connectionState !== ConnectionState.Disconnected;

  return (
    <div className="fixed bottom-20 right-6 z-40 flex flex-col items-end gap-2 font-sans">
      {open && (
        <section
          aria-label="Meeting"
          data-testid="voice-card"
          className="box-border flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-4 rounded-[20px] border border-(--line-3) bg-(--surface-2) p-4.5 shadow-[0_30px_70px_rgba(0,0,0,0.5)] animate-fade-in"
        >
          <header className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              {inCall && (
                <span className="lp-live size-2 rounded-full bg-(--lime)" />
              )}
              {inCall ? "In meeting" : "Meeting"}
            </h2>
            <div className="flex items-center gap-1">
              {settings && (
                <button
                  type="button"
                  aria-label="Open meetings"
                  onClick={() => settings.open("Meetings")}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-(--muted-foreground) hover:cursor-pointer hover:bg-(--surface-4) hover:text-(--foreground)"
                >
                  Meetings <span aria-hidden="true">→</span>
                </button>
              )}
              <button
                type="button"
                aria-label="Hide meeting"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-(--muted-foreground) hover:cursor-pointer hover:bg-(--surface-4) hover:text-(--foreground)"
              >
                <CaretDown className="h-4 w-4" />
              </button>
            </div>
          </header>
          <VoiceControls />
        </section>
      )}

      {!open && (
        <button
          type="button"
          data-testid="voice-dock-toggle"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-(--line-3) bg-(--surface-2) px-4 py-2.5 text-xs font-semibold shadow-lg hover:cursor-pointer hover:border-(--violet)/50"
        >
          {inCall ? (
            <>
              <span className="lp-live size-2 rounded-full bg-(--lime)" />
              In meeting
              {isMuted && (
                <>
                  <MicrophoneOff className="h-3.5 w-3.5 text-red-400" />
                  <span className="sr-only">muted</span>
                </>
              )}
            </>
          ) : (
            <>
              <Headphones className="h-3.5 w-3.5" />
              {voiceUsers.length > 0 ? "Join meeting" : "Start meeting"}
              {voiceUsers.length > 0 && (
                <span className="rounded-full bg-(--lime)/15 px-1.5 text-[10px] text-(--lime)">
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
