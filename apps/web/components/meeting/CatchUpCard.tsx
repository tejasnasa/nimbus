/**
 * @module web/components/meeting/CatchUpCard
 * @description A dismissible "Catch me up" card shown above the live captions
 * once the assistant's meeting is more than two minutes old, for someone who
 * joined partway through (or who stepped away). Asking fetches the summary so
 * far on demand; the card does not fetch by itself.
 *
 * Dismissal is remembered per meeting for the browser session, so closing it
 * does not bring it back on the next render but a new meeting shows it again.
 *
 * @important The card's visibility is decided from the meeting's start time and
 *            a timer set for the moment the threshold passes, not from a polling
 *            interval. Storage access sits in try/catch: a browser that blocks
 *            it only loses the "stay dismissed" memory for a reload.
 */
"use client";

import { useEffect, useState } from "react";
import { useCatchUp } from "../../hooks/useCatchUp";
import { useAssistant } from "../../providers/MeetingProvider";
import CatchUpSummary from "./CatchUpSummary";

/** How old a meeting must be before the card is offered. */
export const CATCH_UP_AFTER_MS = 2 * 60_000;

const dismissedKey = (meetingId: string) =>
  `nimbus:catch-up-dismissed:${meetingId}`;

function readDismissed(meetingId: string): boolean {
  try {
    return window.sessionStorage.getItem(dismissedKey(meetingId)) === "1";
  } catch {
    return false;
  }
}

/** Renders nothing until the live meeting passes the threshold. */
export default function CatchUpCard() {
  const { meeting } = useAssistant();
  const meetingId = meeting?.status === "LIVE" ? meeting.id : null;
  const startedAt = meeting ? Date.parse(meeting.startedAt) : 0;
  const { state, load } = useCatchUp(meetingId);
  const [old, setOld] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!meetingId) {
      setOld(false);
      return;
    }
    const wait = startedAt + CATCH_UP_AFTER_MS - Date.now();
    if (wait <= 0) {
      setOld(true);
      return;
    }
    setOld(false);
    const timer = window.setTimeout(() => setOld(true), wait);
    return () => window.clearTimeout(timer);
  }, [meetingId, startedAt]);

  if (!meetingId || !old) return null;
  if (dismissedFor === meetingId || readDismissed(meetingId)) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(dismissedKey(meetingId), "1");
    } catch {
      // The in-memory flag below still hides it for this page load.
    }
    setDismissedFor(meetingId);
  };

  return (
    <section
      aria-label="Catch me up"
      data-testid="catch-up-card"
      className="mb-2 rounded-xl border border-(--border) bg-(--background)/90 p-3 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-semibold">
            Joined partway through? Get the short version.
          </p>
          {state.kind === "idle" ? (
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg bg-(--primary) px-3 py-1 text-xs font-semibold text-(--primary-foreground) hover:cursor-pointer hover:opacity-90"
            >
              Catch me up
            </button>
          ) : (
            <CatchUpSummary state={state} onRetry={() => void load()} />
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss catch me up"
          onClick={dismiss}
          className="shrink-0 text-(--muted-foreground) hover:cursor-pointer hover:text-(--foreground)"
        >
          ×
        </button>
      </div>
    </section>
  );
}
