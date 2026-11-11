/**
 * @module web/components/meeting/LiveTranscript
 * @description The full running transcript of the current meeting, shown as a
 * collapsible panel under the call controls. Each line carries the speaker and
 * the time into the meeting. The list follows the newest line unless the
 * reader has scrolled up to read earlier ones.
 *
 * Earlier lines are paged in by the meeting hook (`afterSeq`), so a person who
 * joins mid-meeting sees the conversation so far.
 *
 * A "Catch me up" button beside the toggle asks the server for a short summary
 * of the meeting so far and shows it in place.
 *
 * @important The panel renders nothing when there is no transcript to show, so
 *            a call without the assistant gains no empty chrome.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useCatchUp } from "../../hooks/useCatchUp";
import { useAssistant } from "../../providers/MeetingProvider";
import CatchUpSummary from "./CatchUpSummary";

/** Formats milliseconds into the meeting as `m:ss`. */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function LiveTranscript() {
  const { segments, meeting } = useAssistant();
  const [open, setOpen] = useState(false);
  const catchUp = useCatchUp(meeting?.id ?? null);
  const listRef = useRef<HTMLUListElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (open && el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [open, segments]);

  if (!meeting && segments.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-semibold text-(--muted-foreground) hover:cursor-pointer hover:text-(--foreground)"
        >
          {open ? "Hide transcript" : `Show transcript (${segments.length})`}
        </button>
        {meeting && (
          <button
            type="button"
            onClick={() => void catchUp.load()}
            disabled={catchUp.state.kind === "loading"}
            className="text-xs font-semibold text-(--primary) hover:cursor-pointer hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          >
            Catch me up
          </button>
        )}
      </div>
      <CatchUpSummary
        state={catchUp.state}
        onRetry={() => void catchUp.load()}
      />
      {open && (
        <ul
          ref={listRef}
          aria-label="Meeting transcript"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinnedRef.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="flex max-h-64 flex-col gap-1.5 overflow-y-auto rounded-lg bg-(--muted)/40 p-2 text-xs"
        >
          {segments.length === 0 && (
            <li className="text-(--muted-foreground)">Nothing said yet.</li>
          )}
          {segments.map((segment) => (
            <li key={segment.seq} data-testid="transcript-line">
              <span className="mr-1 text-(--muted-foreground)">
                {formatOffset(segment.startMs)}
              </span>
              <span className="font-semibold">{segment.speakerName}: </span>
              {segment.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
