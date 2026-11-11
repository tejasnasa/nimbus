/**
 * @module web/hooks/useActionItems
 * @description The workspace-wide action items view of the Meetings tab: items
 * from `GET /api/action-items` for a mine, open or all filter, paged by cursor
 * with Previous and Next, and kept current over `meeting:action-items`.
 *
 * Also `useActionItemEditor`, the mutation shared by this view and a meeting's
 * own list: check off, reassign and set or clear a due date.
 *
 * @important A socket event updates rows already on the page in place and drops
 *            removed ones. An item the page does not hold may or may not belong
 *            on it under the current filter and page, so that case reloads the
 *            page quietly instead of guessing.
 */
import type { ActionItemDTO, ActionItemsChangedDTO } from "@nimbus/types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchActionItems,
  patchActionItem,
  type ActionItemChange,
  type ActionItemFilter,
} from "../lib/meetingApi";
import { socket } from "../lib/socket";

/** Items per page. */
export const ACTION_ITEMS_PAGE_SIZE = 20;

/** The three views the filter control offers. */
export type ActionItemScope = "mine" | "open" | "all";

/** Maps the control's choice to the API's filter. */
export function filterFor(scope: ActionItemScope): ActionItemFilter {
  if (scope === "mine") return { status: "open", mine: true };
  if (scope === "open") return { status: "open", mine: false };
  return { status: "all", mine: false };
}

export type UseActionItems = {
  items: ActionItemDTO[];
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  loading: boolean;
  error: string | null;
  nextPage: () => Promise<void>;
  previousPage: () => Promise<void>;
  /** Swaps in an item the viewer just edited. */
  replaceItem: (item: ActionItemDTO) => void;
};

/**
 * @param workspaceId - The workspace cuid.
 * @param scope - Which items to list.
 */
export function useActionItems(
  workspaceId: string,
  scope: ActionItemScope,
): UseActionItems {
  const [items, setItems] = useState<ActionItemDTO[]>([]);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const cursorsRef = useRef(cursors);
  const itemsRef = useRef(items);

  const loadPage = useCallback(
    async (stack: Array<string | null>, quiet = false) => {
      const mine = ++generation.current;
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      const result = await fetchActionItems(
        workspaceId,
        filterFor(scope),
        stack[stack.length - 1] ?? null,
        ACTION_ITEMS_PAGE_SIZE,
      );
      if (mine !== generation.current) return;
      if (result.ok) {
        itemsRef.current = result.data.items;
        setItems(result.data.items);
        setNextCursor(result.data.nextCursor);
        setCursors(stack);
        cursorsRef.current = stack;
      } else if (!quiet) {
        setError(result.message);
      }
      if (!quiet) setLoading(false);
    },
    [workspaceId, scope],
  );

  useEffect(() => {
    void loadPage([null]);
  }, [loadPage]);

  useEffect(() => {
    const onChanged = (data: ActionItemsChangedDTO) => {
      const known = new Set(itemsRef.current.map((item) => item.id));
      const changed = new Map(data.items.map((item) => [item.id, item]));
      const removed = new Set(data.removedIds);
      const next = itemsRef.current
        .filter((item) => !removed.has(item.id))
        .filter(
          (item) =>
            // A meeting's set is complete: one of its items missing from it is gone.
            data.meetingId === null ||
            item.meetingId !== data.meetingId ||
            changed.has(item.id),
        )
        .map((item) => changed.get(item.id) ?? item);
      itemsRef.current = next;
      setItems(next);
      if (data.items.some((item) => !known.has(item.id))) {
        void loadPage(cursorsRef.current, true);
      }
    };
    socket.on("meeting:action-items", onChanged);
    return () => {
      socket.off("meeting:action-items", onChanged);
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

  const replaceItem = useCallback((item: ActionItemDTO) => {
    const next = itemsRef.current.map((existing) =>
      existing.id === item.id ? item : existing,
    );
    itemsRef.current = next;
    setItems(next);
  }, []);

  return {
    items,
    page: cursors.length,
    hasPrevious: cursors.length > 1,
    hasNext: nextCursor !== null,
    loading,
    error,
    nextPage,
    previousPage,
    replaceItem,
  };
}

/**
 * The edit action for action items, with the one in flight and the last
 * failure.
 *
 * @param onChanged - Called with the server's updated item after a save.
 */
export function useActionItemEditor(onChanged: (item: ActionItemDTO) => void) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (itemId: string, change: ActionItemChange) => {
      setPendingId(itemId);
      setError(null);
      const result = await patchActionItem(itemId, change);
      setPendingId(null);
      if (result.ok) onChanged(result.data);
      else setError(result.message);
    },
    [onChanged],
  );

  return { pendingId, error, update };
}
