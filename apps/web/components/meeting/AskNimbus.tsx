/**
 * @module web/components/meeting/AskNimbus
 * @description The in-call controls for talking to the assistant: an **Ask
 * Nimbus** button held while asking (pointer down and up, or Space while the
 * button has focus), a **Stop** action while Nimbus is speaking, and a toggle
 * that mutes Nimbus's voice for this viewer only.
 *
 * Holding the button tells the agent, over a LiveKit RPC (`nimbus.ask`), that
 * what this person says is addressed to it, so no wake word is needed; release
 * sends the same call with `pressed: false`. Stop calls `nimbus.stop`.
 *
 * @important The button is disabled unless the assistant is live: a meeting is
 *            running, the agent is in the room and it is past joining. The
 *            agent is found by participant kind, never by name, and the RPC
 *            goes to its identity. A failed call is reported in one line and
 *            the button resets; nothing retries.
 *
 * @important Muting only silences the assistant's audio on this device (see
 *            `VoiceProvider`); everyone else still hears it, and its answers
 *            still appear in captions.
 */
"use client";

import { AGENT_RPC_ASK, AGENT_RPC_STOP } from "@nimbus/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCaptionPrefs } from "../../hooks/useCaptionPrefs";
import { useAssistant } from "../../providers/MeetingProvider";
import { useVoice } from "../../providers/VoiceProvider";

/** Shown when the agent could not be reached. */
export const ASK_FAILED_MESSAGE = "Nimbus didn't get that. Try again.";

const isSpace = (event: React.KeyboardEvent) =>
  event.key === " " || event.code === "Space";

export default function AskNimbus() {
  const { meeting, assistantState } = useAssistant();
  const { room, participants, localUser } = useVoice();
  const { prefs, update } = useCaptionPrefs(localUser.userId);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heldRef = useRef(false);

  const agent = participants.find((p) => p.isAgent);
  const live =
    meeting !== null &&
    agent !== undefined &&
    assistantState !== null &&
    assistantState !== "joining" &&
    assistantState !== "stopped";

  const call = useCallback(
    async (method: string, payload: string) => {
      if (!agent) return;
      try {
        await room.localParticipant.performRpc({
          destinationIdentity: agent.userId,
          method,
          payload,
        });
        setError(null);
      } catch {
        setError(ASK_FAILED_MESSAGE);
      }
    },
    [room, agent],
  );

  const press = useCallback(() => {
    if (!live || heldRef.current) return;
    heldRef.current = true;
    setHeld(true);
    void call(AGENT_RPC_ASK, JSON.stringify({ pressed: true }));
  }, [live, call]);

  const release = useCallback(() => {
    if (!heldRef.current) return;
    heldRef.current = false;
    setHeld(false);
    void call(AGENT_RPC_ASK, JSON.stringify({ pressed: false }));
  }, [call]);

  // The assistant leaving mid-press releases the button.
  useEffect(() => {
    if (!live && heldRef.current) {
      heldRef.current = false;
      setHeld(false);
    }
  }, [live]);

  if (!meeting) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!live}
          aria-pressed={held}
          data-testid="ask-nimbus"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            press();
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (!isSpace(event)) return;
            event.preventDefault();
            if (!event.repeat) press();
          }}
          onKeyUp={(event) => {
            if (!isSpace(event)) return;
            event.preventDefault();
            release();
          }}
          onBlur={release}
          className={`select-none touch-none px-3 py-1.5 rounded-lg text-xs font-semibold hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            held
              ? "bg-(--chart-2) text-white"
              : "bg-(--muted) text-(--foreground) hover:bg-(--muted)/80"
          }`}
        >
          {held ? "Listening... release to send" : "Hold to ask Nimbus"}
        </button>
        {assistantState === "speaking" && (
          <button
            type="button"
            data-testid="stop-nimbus"
            onClick={() => void call(AGENT_RPC_STOP, "{}")}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:cursor-pointer"
          >
            Stop
          </button>
        )}
        <button
          type="button"
          aria-pressed={prefs.muteAssistant}
          data-testid="mute-nimbus"
          onClick={() => update({ muteAssistant: !prefs.muteAssistant })}
          title="Only you stop hearing Nimbus; its answers still show in captions"
          className="px-2 py-1.5 rounded-lg text-xs text-(--muted-foreground) hover:bg-(--muted) hover:cursor-pointer"
        >
          {prefs.muteAssistant ? "Unmute Nimbus" : "Mute Nimbus"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500 leading-snug">
          {error}
        </p>
      )}
    </div>
  );
}
