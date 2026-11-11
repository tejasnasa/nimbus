/**
 * @module web/lib/meetingFormat
 * @description Plain formatting helpers shared by the Meetings tab and the call
 * UI: how long a meeting ran, what to call it, what its status reads as, the
 * transcript clock, a stable colour per speaker, and splitting a search snippet
 * into text and highlighted runs.
 *
 * @important `splitSnippet` is what keeps search results safe. It recognises
 *            only the exact `<mark>` and `</mark>` tags the API adds and returns
 *            everything else as text for React to escape; there is no path from
 *            transcript text to markup.
 */
import type { MeetingStatus } from "@nimbus/types";

/** The fields of a meeting these helpers read. */
type MeetingTimes = {
  startedAt: string;
  endedAt: string | null;
};

/** "12 min", "1 h 5 min" or "Under a minute"; "Live now" while it runs. */
export function describeDuration(meeting: MeetingTimes): string {
  if (!meeting.endedAt) return "Live now";
  const minutes = Math.round(
    (Date.parse(meeting.endedAt) - Date.parse(meeting.startedAt)) / 60_000,
  );
  if (minutes < 1) return "Under a minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Offset into the meeting as `m:ss`. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The meeting's title, or a date-based name until the notes give it one. */
export function meetingTitle(meeting: {
  title: string | null;
  startedAt: string;
}): string {
  if (meeting.title) return meeting.title;
  return `Untitled meeting, ${new Date(meeting.startedAt).toLocaleDateString()}`;
}

/** What the status reads as to a person. */
export function statusLabel(status: MeetingStatus): string {
  switch (status) {
    case "LIVE":
      return "Live";
    case "ENDED":
      return "Writing notes…";
    case "SUMMARIZED":
      return "Notes ready";
    case "FAILED":
      return "Notes failed";
  }
}

/** Tailwind classes giving each status a distinct tone. */
export function statusTone(status: MeetingStatus): string {
  switch (status) {
    case "LIVE":
      return "bg-(--chart-2)/15 text-(--chart-2)";
    case "ENDED":
      return "bg-(--muted) text-(--muted-foreground)";
    case "SUMMARIZED":
      return "bg-(--primary)/15 text-(--primary)";
    case "FAILED":
      return "bg-(--destructive)/10 text-(--destructive)";
  }
}

/** A stable colour for a speaker's name, the same in every view. */
export function speakerColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash}, 65%, 62%)`;
}

/** A run of a search snippet. */
export type SnippetPart = { text: string; marked: boolean };

/**
 * Splits a snippet on the API's `<mark>` tags into text runs.
 *
 * @param snippet - Raw text with matches wrapped in `<mark>` and `</mark>`.
 */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let marked = false;
  for (const piece of snippet.split(/(<mark>|<\/mark>)/)) {
    if (piece === "<mark>") marked = true;
    else if (piece === "</mark>") marked = false;
    else if (piece) parts.push({ text: piece, marked });
  }
  return parts;
}
