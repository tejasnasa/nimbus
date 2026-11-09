"use client";

/**
 * @module web/components/WorkspaceTranscriptsPanel
 * @description The workspace settings "Transcripts" tab, open to every member:
 * the meetings the assistant has transcribed, newest first, each showing when it
 * happened, how long it ran, who started it and how many lines it holds. Opening
 * a meeting loads and shows its full transcript; the list pages with Previous
 * and Next.
 */
import type { MeetingSummaryDTO } from "@nimbus/types";
import CaretDown from "@nimbus/ui/icons/CaretDown";
import { useState } from "react";
import {
  useWorkspaceMeetings,
  type TranscriptState,
} from "../hooks/useWorkspaceMeetings";
import Pagination from "./Pagination";

/** "12 min", "1 h 5 min" or "under a minute"; "live" while it runs. */
function describeDuration(meeting: MeetingSummaryDTO): string {
  if (!meeting.endedAt) return "Live now";
  const minutes = Math.round(
    (Date.parse(meeting.endedAt) - Date.parse(meeting.startedAt)) / 60_000,
  );
  if (minutes < 1) return "Under a minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Offset into the meeting as `m:ss`. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * @param props.workspaceId - The workspace cuid.
 */
export default function WorkspaceTranscriptsPanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const meetings = useWorkspaceMeetings(workspaceId);
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (meetingId: string) => {
    const next = openId === meetingId ? null : meetingId;
    setOpenId(next);
    if (next) void meetings.loadTranscript(next);
  };

  return (
    <div className="space-y-4" data-testid="workspace-transcripts-panel">
      <p className="text-sm text-(--muted-foreground)">
        Calls NimbusBot transcribed in this workspace. Open one to read what was
        said.
      </p>

      {meetings.error && (
        <p
          role="alert"
          className="text-xs text-(--destructive)"
          data-testid="transcripts-error"
        >
          {meetings.error}
        </p>
      )}

      {meetings.loading && meetings.meetings.length === 0 ? (
        <p className="text-sm text-(--muted-foreground)">Loading meetings…</p>
      ) : meetings.meetings.length === 0 ? (
        <p
          className="text-sm text-(--muted-foreground)"
          data-testid="transcripts-empty"
        >
          No transcripts yet. Start NimbusBot in a call to record one.
        </p>
      ) : (
        <ul
          className={`space-y-2 transition-opacity ${meetings.loading ? "opacity-50" : ""}`}
        >
          {meetings.meetings.map((meeting) => {
            const open = openId === meeting.id;
            return (
              <li
                key={meeting.id}
                data-testid={`transcript-meeting-${meeting.id}`}
                className="rounded-xl border border-(--border) bg-(--muted)/20"
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(meeting.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {new Date(meeting.startedAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-(--muted-foreground)">
                      {describeDuration(meeting)}
                      {meeting.startedByName
                        ? ` · started by ${meeting.startedByName}`
                        : ""}
                      {` · ${meeting.segmentCount} ${meeting.segmentCount === 1 ? "line" : "lines"}`}
                    </p>
                  </div>
                  <CaretDown
                    className={`h-4 w-4 shrink-0 text-(--muted-foreground) transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
                {open && (
                  <Transcript state={meetings.transcripts[meeting.id]} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        testId="transcripts-pagination"
        page={meetings.page}
        hasPrevious={meetings.hasPrevious}
        hasNext={meetings.hasNext}
        disabled={meetings.loading}
        onPrevious={() => void meetings.previousPage()}
        onNext={() => void meetings.nextPage()}
      />
    </div>
  );
}

/** The opened meeting's lines, or its loading and error states. */
function Transcript({ state }: { state: TranscriptState | undefined }) {
  if (!state || state.kind === "loading") {
    return (
      <p className="px-4 pb-3 text-xs text-(--muted-foreground)">
        Loading transcript…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p role="alert" className="px-4 pb-3 text-xs text-(--destructive)">
        {state.message}
      </p>
    );
  }
  if (state.segments.length === 0) {
    return (
      <p className="px-4 pb-3 text-xs text-(--muted-foreground)">
        Nothing was transcribed in this meeting.
      </p>
    );
  }
  return (
    <ol
      className="max-h-80 space-y-1.5 overflow-y-auto border-t border-(--border) px-4 py-3 text-xs scrollbar-thin"
      data-testid="transcript-lines"
    >
      {state.segments.map((segment) => (
        <li key={segment.id} className="flex gap-3">
          <span className="w-10 shrink-0 font-mono text-(--muted-foreground)">
            {clock(segment.startMs)}
          </span>
          <p>
            <span className="font-semibold">{segment.speakerName}:</span>{" "}
            {segment.text}
          </p>
        </li>
      ))}
    </ol>
  );
}
