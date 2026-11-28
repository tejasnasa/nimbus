/**
 * @module web/components/meeting/AssistantPanel
 * @description The in-call assistant's section of the call card. It starts and
 * stops Nimbus, and while Nimbus is in the call it shows what the assistant is
 * doing (a spinner while it joins; then listening, thinking or speaking with a
 * small status dot, and level bars that move while it speaks), a
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
import Logo from "@nimbus/ui/Logo";
import LogoSpinner from "@nimbus/ui/LogoSpinner";
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
  joining: "bg-(--amber) animate-pulse motion-reduce:animate-none",
  listening: "bg-(--lime)",
  thinking: "bg-(--violet) animate-pulse motion-reduce:animate-none",
  speaking: "bg-(--lime) animate-pulse motion-reduce:animate-none",
  stopped: "bg-(--muted-foreground)",
  "answered-in-chat": "bg-(--lime)",
};

/** The state line's text colour for each state. */
const STATE_TEXT: Record<AssistantState, string> = {
  joining: "text-(--amber)",
  listening: "text-(--muted-foreground)",
  thinking: "text-(--violet-pale)",
  speaking: "text-lime-400",
  stopped: "text-(--muted-foreground)",
  "answered-in-chat": "text-lime-400",
};

/** Heights of the level bars beside the assistant; they move only while it speaks. */
const BAR_HEIGHTS = [8, 14, 20, 12, 18, 22, 10, 16];

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
  "grid h-8 w-8 place-items-center rounded-[9px] text-(--muted-foreground) hover:cursor-pointer hover:bg-(--surface-4) hover:text-(--foreground)";

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
      className={`flex flex-col gap-3 rounded-[14px] border p-3 transition-colors ${
        live
          ? "border-(--violet)/30 bg-(--surface-3)"
          : "border-dashed border-(--line-3)"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="relative size-11 shrink-0">
          {assistantState === "speaking" && active && (
            <span className="ws-orbit absolute inset-0 rounded-2xl border-2 border-(--lime)" />
          )}
          {assistantState === "thinking" && active && (
            <svg
              className="ws-spin absolute inset-0"
              width="44"
              height="44"
              viewBox="0 0 52 52"
              aria-hidden="true"
            >
              <circle
                cx="26"
                cy="26"
                r="24"
                fill="none"
                stroke="var(--violet)"
                strokeWidth="2"
                strokeDasharray="30 120"
                strokeLinecap="round"
              />
            </svg>
          )}
          <span className="absolute inset-1 grid place-items-center rounded-xl bg-(--surface-1)">
            <Logo size={22} wordmark={false} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">
            {live ? "Nimbus" : "Nimbus assistant"}
          </p>
          {live && assistantState === "joining" ? (
            <LogoSpinner
              label="Joining the call"
              size={16}
              className="mt-1"
            />
          ) : live && assistantState ? (
            <p
              data-testid="assistant-state"
              className={`mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-xs leading-tight transition-colors ${STATE_TEXT[assistantState]}`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[assistantState]}`}
              />
              {STATE_LABEL[assistantState]}
            </p>
          ) : (
            <p className="mt-0.5 text-xs leading-tight text-(--muted-foreground)">
              {inCall || live
                ? "Captions, notes and answers"
                : "Join the call to start Nimbus."}
            </p>
          )}
        </div>
        {active && (
          <div className="flex h-6 items-center gap-0.5" aria-hidden="true">
            {BAR_HEIGHTS.map((height, i) => (
              <div
                key={i}
                className="ws-bar w-0.75 rounded-xs"
                style={{
                  height,
                  animationDelay: `-${(i * 0.12).toFixed(2)}s`,
                  animationPlayState:
                    assistantState === "speaking" ? "running" : "paused",
                  background:
                    assistantState === "speaking"
                      ? "var(--lime)"
                      : "var(--line-3)",
                }}
              />
            ))}
          </div>
        )}
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
              <SpeakerOff className="h-4 w-4 text-red-400" />
            ) : (
              <Speaker className="h-4 w-4" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => void (live ? stop() : start())}
          disabled={disabled}
          className={`shrink-0 rounded-[9px] px-3 py-1.5 text-[13px] font-semibold hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
            live
              ? "border border-(--line-3) text-(--text-body) hover:bg-(--surface-4)"
              : "bg-(--lime) text-(--ink) hover:opacity-90"
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
          className="self-start rounded-[9px] bg-(--violet)/15 px-3 py-1.5 text-xs font-semibold text-(--violet-soft) hover:cursor-pointer hover:bg-(--violet)/25"
        >
          Stop talking
        </button>
      )}

      {active && (
        <p
          data-testid="wake-hint"
          className="text-[11px] leading-tight text-(--muted-foreground)"
        >
          Say &ldquo;Nimbus&rdquo; to ask it something.
        </p>
      )}

      {refusal && (
        <p role="alert" className="text-xs leading-snug text-red-400">
          {refusal.message}
        </p>
      )}
      {(error || rpcError) && (
        <p role="alert" className="text-xs leading-snug text-red-400">
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
