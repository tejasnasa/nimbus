/**
 * @module web/hooks/useWorkspaceMeetings
 * @description The settings Meetings tab's list: the workspace's meetings,
 * newest first, paged from `GET /api/meetings`.
 *
 * Like the usage log, the server pages by cursor and the hook remembers the
 * cursor that opened each visited page, so Previous works without page numbers
 * on the server.
 *
 * The list stays current over the socket: a meeting starting, ending or having
 * its notes written reloads the page on screen in place (no loading flash, so a
 * row's status changes under the reader), and a deleted meeting drops out at
 * once.
 *
 * @important A reload triggered by the socket keeps the page the reader is on
 *            and is discarded if they have paged since, the same generation
 *            guard that protects explicit paging.
 */
import type { MeetingSummaryDTO } from "@nimbus/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMeetings } from "../lib/meetingApi";
import { socket } from "../lib/socket";

/** Meetings per page. */
export const MEETINGS_PAGE_SIZE = 10;

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
};

/**
 * @param workspaceId - The workspace cuid.
 * @returns The page of meetings and the paging handlers.
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
  // Guards against an older page landing after a newer request.
  const generation = useRef(0);
  const cursorsRef = useRef(cursors);

  const loadPage = useCallback(
    async (stack: Array<string | null>, quiet = false) => {
      const mine = ++generation.current;
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
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
        cursorsRef.current = stack;
      } else if (!quiet) {
        setError(result.message);
      }
      if (!quiet) setLoading(false);
    },
    [workspaceId],
  );

  useEffect(() => {
    void loadPage([null]);
  }, [loadPage]);

  useEffect(() => {
    const reload = () => void loadPage(cursorsRef.current, true);
    const onDeleted = ({ meetingId }: { meetingId: string }) => {
      setMeetings((rows) => rows.filter((row) => row.id !== meetingId));
    };
    socket.on("meeting:started", reload);
    socket.on("meeting:ended", reload);
    socket.on("meeting:notes-ready", reload);
    socket.on("meeting:deleted", onDeleted);
    return () => {
      socket.off("meeting:started", reload);
      socket.off("meeting:ended", reload);
      socket.off("meeting:notes-ready", reload);
      socket.off("meeting:deleted", onDeleted);
    };
  }, [loadPage]);

  const nextPage = useCallback(async () => {
    if (!nextCursor) return;
    await loadPage([...cursors, nextCursor]);
  }, [cursors, nextCursor, loadPage]);

  const previousPage = useCallback(async () => {
    if (cursors.length < 2) return;
    await loadPage(cursors.slice(0, -1));
  }, [cursors, loadPage]);

  return {
    meetings,
    page: cursors.length,
    hasPrevious: cursors.length > 1,
    hasNext: nextCursor !== null,
    loading,
    error,
    nextPage,
    previousPage,
  };
}
