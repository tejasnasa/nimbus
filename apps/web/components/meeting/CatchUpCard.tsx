/**
 * @module web/components/meeting/CatchUpCard
 * @description A dismissible "Catch me up" offer shown above the live captions
 * once the assistant's meeting is more than two minutes old, for someone who
 * joined partway through (or who stepped away). Until it is used it is a slim
 * pill; asking fetches the summary so far on demand (the card does not fetch by
 * itself) and the pill opens into a card that holds it.
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

  const dismissButton = (
    <button
      type="button"
      aria-label="Dismiss catch me up"
      onClick={dismiss}
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-(--muted-foreground) hover:cursor-pointer hover:bg-(--muted) hover:text-(--foreground)"
    >
      ×
    </button>
  );

  if (state.kind === "idle") {
    return (
      <section
        aria-label="Catch me up"
        data-testid="catch-up-card"
        className="mx-auto mb-2 flex w-fit max-w-full items-center gap-2 rounded-full border border-(--border) bg-(--background)/90 py-1 pr-1.5 pl-3 shadow-lg backdrop-blur-md"
      >
        <p className="truncate text-xs text-(--muted-foreground)">
          Joined partway through?
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="shrink-0 rounded-full bg-(--primary) px-3 py-0.5 text-xs font-semibold text-(--primary-foreground) hover:cursor-pointer hover:opacity-90"
        >
          Catch me up
        </button>
        {dismissButton}
      </section>
    );
  }

  return (
    <section
      aria-label="Catch me up"
      data-testid="catch-up-card"
      className="mb-2 rounded-2xl border border-(--border) bg-(--background)/90 px-4 py-3 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold">The short version so far</p>
          <CatchUpSummary state={state} onRetry={() => void load()} />
        </div>
        {dismissButton}
      </div>
    </section>
  );
}
