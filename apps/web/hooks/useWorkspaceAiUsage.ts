/**
 * @module web/hooks/useWorkspaceAiUsage
 * @description The admin Usage tab's data: this month's totals and the call log,
 * paged from `GET /api/ai/workspaces/:workspaceId/usage`.
 *
 * The server pages by cursor, which only moves forward, so the hook remembers
 * the cursor that opened each page it has visited; that is what lets Previous
 * go back without the server knowing about page numbers. Changing a filter
 * restarts from the first page. A failed page leaves the current one in place
 * and reports the message, so a flaky network does not blank the table.
 */
import type { AiCallDTO, AiFeature, AiUsageDTO } from "@nimbus/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { aiApi, workspaceAiPath } from "../lib/aiApi";

/** The filters the table offers. An empty value means "any". */
export type UsageFilters = {
  feature?: AiFeature;
  status?: AiCallDTO["status"];
  userId?: string;
};

export type UseWorkspaceAiUsage = {
  calls: AiCallDTO[];
  totals: AiUsageDTO["totals"] | null;
  /** One-based number of the page on screen. */
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  loading: boolean;
  error: string | null;
  filters: UsageFilters;
  setFilters: (next: UsageFilters) => void;
  nextPage: () => Promise<void>;
  previousPage: () => Promise<void>;
  refresh: () => Promise<void>;
};

/** Page size requested from the server. */
export const USAGE_PAGE_SIZE = 25;

function usagePath(
  workspaceId: string,
  filters: UsageFilters,
  cursor: string | null,
): string {
  const params = new URLSearchParams({ limit: String(USAGE_PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  if (filters.feature) params.set("feature", filters.feature);
  if (filters.status) params.set("status", filters.status);
  if (filters.userId) params.set("userId", filters.userId);
  return `${workspaceAiPath(workspaceId, "/usage")}?${params.toString()}`;
}

/**
 * @param workspaceId - The workspace cuid.
 * @param enabled - Whether the caller may read usage (admin or owner).
 * @returns The rows, totals, paging state and the filter and paging handlers.
 */
export function useWorkspaceAiUsage(
  workspaceId: string,
  enabled = true,
): UseWorkspaceAiUsage {
  const [calls, setCalls] = useState<AiCallDTO[]>([]);
  const [totals, setTotals] = useState<AiUsageDTO["totals"] | null>(null);
  // `cursors[i]` opened page i + 1; the first page has no cursor.
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<UsageFilters>({});
  // Guards against an older response landing after a newer request.
  const generation = useRef(0);

  const loadPage = useCallback(
    async (stack: Array<string | null>) => {
      if (!enabled) return;
      const mine = ++generation.current;
      setLoading(true);
      setError(null);
      const result = await aiApi<AiUsageDTO>(
        usagePath(workspaceId, filters, stack[stack.length - 1] ?? null),
        {},
        "Could not load usage. Please try again.",
      );
      if (mine !== generation.current) return;
      if (result.ok) {
        setCalls(result.data.calls);
        setTotals(result.data.totals);
        setNextCursor(result.data.nextCursor);
        setCursors(stack);
      } else {
        setError(result.message);
      }
      setLoading(false);
    },
    [workspaceId, filters, enabled],
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

  const refresh = useCallback(() => loadPage(cursors), [cursors, loadPage]);

  return {
    calls,
    totals,
    page: cursors.length,
    hasPrevious: cursors.length > 1,
    hasNext: nextCursor !== null,
    loading,
    error,
    filters,
    setFilters,
    nextPage,
    previousPage,
    refresh,
  };
}
