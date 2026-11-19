/**
 * @module web/components/meeting/AssistantPanel
 * @description The in-call assistant's section of the call card. It starts and
 * stops Nimbus, and while Nimbus is in the call it shows what the assistant is
 * doing (joining, listening, thinking, speaking) with a small status dot, a
 * one-line reminder that saying its name is how to ask it something, a
 * **Stop talking** action while it speaks, and a toggle that mutes Nimbus's
 * voice for this viewer only.
 *
 * Before Nimbus can start it explains why not (the user is not in the call),
 * and after a meeting ends it says why Nimbus left. A start the server refuses
 * shows the server's curated message.
 *
 * Stop talking calls the agent over a LiveKit RPC (`nimbus.stop`), addressed to
 * the agent's identity, which is found by participant kind, never by name. A
 * failed call is reported in one line; nothing retries.
 *
 * @important The server is the authority on whether the assistant may start;
 *            this component only explains. It never decides from the client's
 *            copy of the workspace's AI settings.
 *
 * @important Muting only silences the assistant's audio on this device (see
 *            `VoiceProvider`); everyone else still hears it, and its answers
 *            still appear in captions.
 */
"use client";

import type { AssistantState, MeetingEndReason } from "@nimbus/types";
import { AGENT_RPC_STOP } from "@nimbus/types";
import Cloud from "@nimbus/ui/icons/Cloud";
import Speaker from "@nimbus/ui/icons/Speaker";
import SpeakerOff from "@nimbus/ui/icons/SpeakerOff";
import { useState } from "react";
import { useCaptionPrefs } from "../../hooks/useCaptionPrefs";
import { useAssistant } from "../../providers/MeetingProvider";
import { useVoice } from "../../providers/VoiceProvider";

/** Shown when the agent could not be reached. */
export const STOP_FAILED_MESSAGE = "Nimbus didn't get that. Try again.";

const STATE_LABEL: Record<AssistantState, string> = {
  joining: "Joining the call...",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  stopped: "Leaving...",
  "answered-in-chat": "Answered in chat",
};

/** The status dot's colour and motion for each state. */
const STATE_DOT: Record<AssistantState, string> = {
  joining: "bg-amber-500 animate-pulse",
  listening: "bg-(--chart-2)",
  thinking: "bg-(--primary) animate-pulse",
  speaking: "bg-(--primary) animate-pulse",
  stopped: "bg-(--muted-foreground)",
  "answered-in-chat": "bg-(--chart-2)",
};

const END_COPY: Record<MeetingEndReason, string | null> = {
  stopped: null,
  budget: "Nimbus left because the free assistant time ran out.",
  "agent-left": "Nimbus left the call.",
  "room-finished": null,
  "agent-ended": "Nimbus left the call.",
  "invalid-key": "Nimbus left because the voice key was rejected.",
  "spend-cap": "Nimbus left because the workspace reached its spend cap.",
  orphaned: "Nimbus left the call.",
  "dispatch-failed": "Nimbus could not join the call.",
};

/** Small square icon button used for the assistant's in-call actions. */
const ICON_BUTTON_CLASS =
  "grid h-7 w-7 place-items-center rounded-lg text-(--muted-foreground) hover:cursor-pointer hover:bg-(--muted) hover:text-(--foreground)";

/**
 * @param props.inCall - Whether the user is connected to the call.
 */
export default function AssistantPanel({ inCall }: { inCall: boolean }) {
  const {
    meeting,
    assistantState,
    isPending,
    refusal,
    error,
    endReason,
    start,
    stop,
  } = useAssistant();
  const { room, participants, localUser } = useVoice();
  const { prefs, update } = useCaptionPrefs(localUser.userId);
  const [rpcError, setRpcError] = useState<string | null>(null);

  const live = meeting !== null;
  const disabled = isPending || (!live && !inCall);
  const agent = participants.find((p) => p.isAgent);
  const active =
    live &&
    assistantState !== null &&
    assistantState !== "joining" &&
    assistantState !== "stopped";

  let label = "Start Nimbus";
  if (isPending && !live) label = "Starting...";
  else if (isPending && live) label = "Stopping...";
  else if (live) label = "Stop Nimbus";

  const endNote = !live && endReason ? END_COPY[endReason] : null;

  const stopTalking = async () => {
    if (!agent) return;
    try {
      await room.localParticipant.performRpc({
        destinationIdentity: agent.userId,
        method: AGENT_RPC_STOP,
        payload: "{}",
      });
      setRpcError(null);
    } catch {
      setRpcError(STOP_FAILED_MESSAGE);
    }
  };

  return (
    <section
      aria-label="Nimbus assistant"
      className="flex flex-col gap-2 rounded-xl border border-(--border) bg-(--muted)/30 p-3"
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-(--primary)/15 text-(--primary) ${
            assistantState === "speaking" ? "ring-2 ring-(--primary)/40" : ""
          }`}
        >
          <Cloud className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-tight">Nimbus</p>
          {live && assistantState ? (
            <p
              data-testid="assistant-state"
              className="flex items-center gap-1.5 text-[11px] leading-tight text-(--muted-foreground)"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[assistantState]}`}
              />
              {STATE_LABEL[assistantState]}
            </p>
          ) : (
            <p className="text-[11px] leading-tight text-(--muted-foreground)">
              {inCall || live
                ? "Captions, notes and answers"
                : "Join the call to start Nimbus."}
            </p>
          )}
        </div>
        {live && (
          <button
            type="button"
            aria-pressed={prefs.muteAssistant}
            aria-label={prefs.muteAssistant ? "Unmute Nimbus" : "Mute Nimbus"}
            data-testid="mute-nimbus"
            onClick={() => update({ muteAssistant: !prefs.muteAssistant })}
            title={
              prefs.muteAssistant
                ? "Hear Nimbus again"
                : "Only you stop hearing Nimbus; its answers still show in captions"
            }
            className={ICON_BUTTON_CLASS}
          >
            {prefs.muteAssistant ? (
              <SpeakerOff className="h-4 w-4 text-red-500" />
            ) : (
              <Speaker className="h-4 w-4" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => void (live ? stop() : start())}
          disabled={disabled}
          className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
            live
              ? "text-(--muted-foreground) hover:bg-red-500/10 hover:text-red-500"
              : "bg-(--primary) text-(--primary-foreground) hover:opacity-90"
          }`}
        >
          {label}
        </button>
      </div>

      {assistantState === "speaking" && active && (
        <button
          type="button"
          data-testid="stop-nimbus"
          onClick={() => void stopTalking()}
          className="self-start rounded-lg bg-(--primary)/10 px-2.5 py-1 text-xs font-semibold text-(--primary) hover:cursor-pointer hover:bg-(--primary)/20"
        >
          Stop talking
        </button>
      )}

      {active && (
        <p
          data-testid="wake-hint"
          className="text-[10px] leading-tight text-(--muted-foreground)"
        >
          Say &ldquo;Nimbus&rdquo; to ask it something.
        </p>
      )}

      {refusal && (
        <p role="alert" className="text-xs leading-snug text-red-500">
          {refusal.message}
        </p>
      )}
      {(error || rpcError) && (
        <p role="alert" className="text-xs leading-snug text-red-500">
          {error ?? rpcError}
        </p>
      )}
      {endNote && (
        <p className="text-xs leading-snug text-(--muted-foreground)">
          {endNote}
        </p>
      )}
    </section>
  );
}
