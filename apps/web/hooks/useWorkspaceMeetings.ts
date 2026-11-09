/**
 * @module web/hooks/useWorkspaceMeetings
 * @description The settings Transcripts tab's data: the workspace's meetings,
 * newest first, paged from `GET /api/meetings`, plus loading one meeting's full
 * transcript on demand.
 *
 * Like the usage log, the server pages by cursor and the hook remembers the
 * cursor that opened each visited page, so Previous works without page numbers
 * on the server. Transcripts are fetched only when a meeting is opened and are
 * kept for the life of the hook, so reopening one does not refetch it.
 */
import type { MeetingSummaryDTO, SegmentDTO } from "@nimbus/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMeetings, fetchSegments } from "../lib/meetingApi";

/** Meetings per page. */
export const MEETINGS_PAGE_SIZE = 10;

/** Upper bound on transcript pages read for one meeting. */
const MAX_TRANSCRIPT_PAGES = 50;

/** One meeting's transcript as the panel renders it. */
export type TranscriptState =
  | { kind: "loading" }
  | { kind: "ready"; segments: SegmentDTO[] }
  | { kind: "error"; message: string };

export type UseWorkspaceMeetings = {
  meetings: MeetingSummaryDTO[];
  /** One-based number of the page on screen. */
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  loading: boolean;
  error: string | null;
  nextPage: () => Promise<void>;
  previousPage: () => Promise<void>;
  /** Transcripts fetched so far, by meeting id. */
  transcripts: Record<string, TranscriptState>;
  /** Fetches a meeting's whole transcript, once. */
  loadTranscript: (meetingId: string) => Promise<void>;
};

/**
 * @param workspaceId - The workspace cuid.
 * @returns The page of meetings, paging handlers and the transcript cache.
 */
export function useWorkspaceMeetings(
  workspaceId: string,
): UseWorkspaceMeetings {
  const [meetings, setMeetings] = useState<MeetingSummaryDTO[]>([]);
  // `cursors[i]` opened page i + 1; the first page has no cursor.
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<
    Record<string, TranscriptState>
  >({});
  // Meetings whose transcript is loaded or loading; a failure is removed so
  // opening the meeting again retries.
  const requested = useRef(new Set<string>());
  // Guards against an older page landing after a newer request.
  const generation = useRef(0);

  const loadPage = useCallback(
    async (stack: Array<string | null>) => {
      const mine = ++generation.current;
      setLoading(true);
      setError(null);
      const result = await fetchMeetings(
        workspaceId,
        stack[stack.length - 1] ?? null,
        MEETINGS_PAGE_SIZE,
      );
      if (mine !== generation.current) return;
      if (result.ok) {
        setMeetings(result.data.meetings);
        setNextCursor(result.data.nextCursor);
        setCursors(stack);
      } else {
        setError(result.message);
      }
      setLoading(false);
    },
    [workspaceId],
  );

  useEffect(() => {
    void loadPage([null]);
  }, [loadPage]);

  const nextPage = useCallback(async () => {
    if (!nextCursor) return;
    await loadPage([...cursors, nextCursor]);
  }, [cursors, nextCursor, loadPage]);

  const previousPage = useCallback(async () => {
    if (cursors.length < 2) return;
    await loadPage(cursors.slice(0, -1));
  }, [cursors, loadPage]);

  const loadTranscript = useCallback(async (meetingId: string) => {
    if (requested.current.has(meetingId)) return;
    requested.current.add(meetingId);
    setTranscripts((t) => ({ ...t, [meetingId]: { kind: "loading" } }));

    const segments: SegmentDTO[] = [];
    let after = 0;
    for (let page = 0; page < MAX_TRANSCRIPT_PAGES; page++) {
      const result = await fetchSegments(meetingId, after);
      if (!result.ok) {
        requested.current.delete(meetingId);
        setTranscripts((t) => ({
          ...t,
          [meetingId]: { kind: "error", message: result.message },
        }));
        return;
      }
      segments.push(...result.data.segments);
      const last = result.data.segments[result.data.segments.length - 1];
      if (!result.data.hasMore || !last) break;
      after = last.seq;
    }
    setTranscripts((t) => ({ ...t, [meetingId]: { kind: "ready", segments } }));
  }, []);

  return {
    meetings,
    page: cursors.length,
    hasPrevious: cursors.length > 1,
    hasNext: nextCursor !== null,
    loading,
    error,
    nextPage,
    previousPage,
    transcripts,
    loadTranscript,
  };
}
