/**
 * @module web/hooks/useMeetingTranscript
 * @description One meeting's whole transcript for the Meetings tab, read across
 * pages and, when a language is given, with each line's stored translation
 * alongside the original text. While the meeting is live, new captions arrive
 * over the socket and are appended.
 *
 * @important Changing the meeting or the language starts a new read and
 *            discards the old one: a response that lands after either changed is
 *            dropped rather than shown under the new choice.
 *
 * @important Live captions are inserted by sequence number and deduplicated. One
 *            that arrives while a read is still in flight is held and merged when
 *            the read finishes, so it is neither lost nor shown twice.
 */
import type { SegmentDTO } from "@nimbus/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSegments } from "../lib/meetingApi";
import { socket } from "../lib/socket";

/** Upper bound on transcript pages read for one meeting. */
const MAX_TRANSCRIPT_PAGES = 50;

/** One meeting's transcript as the panel renders it. */
export type TranscriptState =
  | { kind: "loading" }
  | { kind: "ready"; segments: SegmentDTO[] }
  | { kind: "error"; message: string };

/** Segments in sequence order, one per sequence number (the first wins). */
function mergeSegments(base: SegmentDTO[], extra: SegmentDTO[]): SegmentDTO[] {
  const seen = new Set(base.map((s) => s.seq));
  const added = extra.filter((s) => !seen.has(s.seq));
  if (added.length === 0) return base;
  return [...base, ...added].sort((a, b) => a.seq - b.seq);
}

/**
 * @param meetingId - The meeting to read.
 * @param language - A caption language code, or null for the original only.
 * @param live - Whether to append captions as they arrive.
 * @returns The transcript state and a retry for a failed read.
 */
export function useMeetingTranscript(
  meetingId: string,
  language: string | null,
  live: boolean,
): { state: TranscriptState; retry: () => void } {
  const [state, setState] = useState<TranscriptState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<SegmentDTO[]>([]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    pending.current = [];
    void (async () => {
      const segments: SegmentDTO[] = [];
      let after = 0;
      for (let page = 0; page < MAX_TRANSCRIPT_PAGES; page++) {
        const result = await fetchSegments(meetingId, after, language);
        if (cancelled) return;
        if (!result.ok) {
          setState({ kind: "error", message: result.message });
          return;
        }
        segments.push(...result.data.segments);
        const last = result.data.segments[result.data.segments.length - 1];
        if (!result.data.hasMore || !last) break;
        after = last.seq;
      }
      const held = pending.current;
      pending.current = [];
      setState({ kind: "ready", segments: mergeSegments(segments, held) });
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId, language, attempt]);

  useEffect(() => {
    if (!live) return;
    const onSegment = (data: { meetingId: string; segment: SegmentDTO }) => {
      if (data.meetingId !== meetingId) return;
      setState((prev) => {
        if (prev.kind !== "ready") {
          pending.current.push(data.segment);
          return prev;
        }
        return {
          kind: "ready",
          segments: mergeSegments(prev.segments, [data.segment]),
        };
      });
    };
    socket.on("meeting:segment", onSegment);
    return () => {
      socket.off("meeting:segment", onSegment);
    };
  }, [meetingId, live]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
