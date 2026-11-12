/**
 * @module web/components/meeting/AssistantButton
 * @description Starts and stops the in-call assistant. It is a single button
 * whose label, enabled state and nearby copy follow the assistant's lifecycle:
 * unavailable until the user is in the call (with the reason said plainly),
 * ready to start, starting, and in the call with a Stop control and a one-word
 * status (joining, listening, thinking, speaking).
 *
 * A start the server refuses shows the server's curated message. A meeting
 * that just ended says why.
 *
 * @important The server is the authority on whether the assistant may start;
 *            this component only explains. It never decides from the client's
 *            copy of the workspace's AI settings.
 */
"use client";

import type { AssistantState, MeetingEndReason } from "@nimbus/types";
import { useAssistant } from "../../providers/MeetingProvider";

const STATE_LABEL: Record<AssistantState, string> = {
  joining: "Joining the call...",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  stopped: "Leaving...",
  "answered-in-chat": "Answered in chat",
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

/**
 * @param props.inCall - Whether the user is connected to the call.
 */
export default function AssistantButton({ inCall }: { inCall: boolean }) {
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

  const live = meeting !== null;
  const disabled = isPending || (!live && !inCall);

  let label = "Start Nimbus";
  if (isPending && !live) label = "Starting...";
  else if (isPending && live) label = "Stopping...";
  else if (live) label = "Stop Nimbus";

  const endNote = !live && endReason ? END_COPY[endReason] : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void (live ? stop() : start())}
          disabled={disabled}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            live
              ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
              : "bg-(--primary) text-(--primary-foreground) hover:opacity-90"
          }`}
        >
          {label}
        </button>
        {live && assistantState && (
          <span
            data-testid="assistant-state"
            className="text-xs text-(--muted-foreground)"
          >
            {STATE_LABEL[assistantState]}
          </span>
        )}
      </div>
      {!live && !inCall && (
        <p className="text-xs text-(--muted-foreground)">
          Join the call to start Nimbus.
        </p>
      )}
      {refusal && (
        <p role="alert" className="text-xs text-red-500 leading-snug">
          {refusal.message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-500 leading-snug">
          {error}
        </p>
      )}
      {endNote && (
        <p className="text-xs text-(--muted-foreground) leading-snug">
          {endNote}
        </p>
      )}
    </div>
  );
}
