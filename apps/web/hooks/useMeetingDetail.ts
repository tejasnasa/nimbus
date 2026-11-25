/**
 * @module web/hooks/useMeetingDetail
 * @description One meeting for the Meetings tab's detail view: its notes,
 * decisions, action items and participants from `GET /api/meetings/:id`, kept
 * current over the socket.
 *
 * - `meeting:action-items` for this meeting replaces its action items; an item
 *   edited here is also swapped in directly through `replaceActionItem`, so the
 *   view does not wait for the broadcast.
 * - `meeting:notes-ready` and `meeting:ended` reload the meeting, which is how a
 *   row that read "Writing notes..." turns into the notes without a refresh.
 *
 * @important A reload driven by the socket is silent and keeps the detail on
 *            screen; only the first read shows a loading state. A response for a
 *            meeting the reader has since left is dropped.
 */
import type {
  ActionItemDTO,
  ActionItemsChangedDTO,
  MeetingDetailDTO,
} from "@nimbus/types";
import { useCallback, useEffect, useState } from "react";
import { fetchMeetingDetail } from "../lib/meetingApi";
import { socket } from "../lib/socket";

export type MeetingDetailState =
  | { kind: "loading" }
  | { kind: "ready"; detail: MeetingDetailDTO }
  | { kind: "error"; message: string };

/**
 * @param meetingId - The meeting to read.
 * @returns The detail state and ways to swap in an edited action item, drop a
 *          deleted one and add a new one.
 */
export function useMeetingDetail(meetingId: string): {
  state: MeetingDetailState;
  replaceActionItem: (item: ActionItemDTO) => void;
  removeActionItem: (itemId: string) => void;
  addActionItem: (item: ActionItemDTO) => void;
} {
  const [state, setState] = useState<MeetingDetailState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    const load = async (quiet: boolean) => {
      const result = await fetchMeetingDetail(meetingId);
      if (cancelled) return;
      if (result.ok) {
        setState({ kind: "ready", detail: result.data });
      } else if (!quiet) {
        setState({ kind: "error", message: result.message });
      }
    };
    void load(false);

    const reloadFor = (data: { meetingId: string }) => {
      if (data.meetingId === meetingId) void load(true);
    };
    const onItems = (data: ActionItemsChangedDTO) => {
      if (data.meetingId !== meetingId) return;
      setState((prev) =>
        prev.kind === "ready"
          ? {
              kind: "ready",
              detail: {
                ...prev.detail,
                actionItems: data.items.filter(
                  (item) => !data.removedIds.includes(item.id),
                ),
              },
            }
          : prev,
      );
    };
    socket.on("meeting:notes-ready", reloadFor);
    socket.on("meeting:ended", reloadFor);
    socket.on("meeting:action-items", onItems);
    return () => {
      cancelled = true;
      socket.off("meeting:notes-ready", reloadFor);
      socket.off("meeting:ended", reloadFor);
      socket.off("meeting:action-items", onItems);
    };
  }, [meetingId]);

  const editItems = useCallback(
    (edit: (items: ActionItemDTO[]) => ActionItemDTO[]) => {
      setState((prev) =>
        prev.kind === "ready"
          ? {
              kind: "ready",
              detail: {
                ...prev.detail,
                actionItems: edit(prev.detail.actionItems),
              },
            }
          : prev,
      );
    },
    [],
  );

  const replaceActionItem = useCallback(
    (item: ActionItemDTO) =>
      editItems((items) =>
        items.map((existing) => (existing.id === item.id ? item : existing)),
      ),
    [editItems],
  );

  const removeActionItem = useCallback(
    (itemId: string) =>
      editItems((items) => items.filter((existing) => existing.id !== itemId)),
    [editItems],
  );

  // The broadcast may have landed first, so an item already shown is replaced
  // rather than repeated.
  const addActionItem = useCallback(
    (item: ActionItemDTO) =>
      editItems((items) => [
        ...items.filter((existing) => existing.id !== item.id),
        item,
      ]),
    [editItems],
  );

  return { state, replaceActionItem, removeActionItem, addActionItem };
}
