/**
 * @module web/hooks/useCatchUp
 * @description The "Catch me up" summary of a meeting in progress, fetched only
 * when the viewer asks for it and again when they ask again. The server decides
 * whether to refresh its stored summary first.
 *
 * @important Switching to a different meeting forgets the previous summary, so
 *            one meeting's bullets are never shown under another.
 */
import type { CatchUpDTO } from "@nimbus/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCatchUp } from "../lib/meetingApi";

export type CatchUpState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; catchUp: CatchUpDTO }
  | { kind: "error"; message: string };

/** @param meetingId - The live meeting, or null when there is none. */
export function useCatchUp(meetingId: string | null) {
  const [state, setState] = useState<CatchUpState>({ kind: "idle" });
  const current = useRef(meetingId);

  useEffect(() => {
    current.current = meetingId;
    setState({ kind: "idle" });
  }, [meetingId]);

  const load = useCallback(async () => {
    if (!meetingId) return;
    setState({ kind: "loading" });
    const result = await fetchCatchUp(meetingId);
    if (current.current !== meetingId) return;
    setState(
      result.ok
        ? { kind: "ready", catchUp: result.data }
        : { kind: "error", message: result.message },
    );
  }, [meetingId]);

  return { state, load };
}
