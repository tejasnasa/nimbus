/**
 * @module web/hooks/useWorkspaceAiUsage
 * @description The admin Usage tab's data: this month's totals and the call log,
 * cursor-paged from `GET /api/ai/workspaces/:workspaceId/usage`.
 *
 * Changing a filter restarts from the first page; `loadMore` appends the next
 * one. A failed page leaves what is already shown in place and reports the
 * message, so a flaky network does not blank the table.
 */
import type {
  AiCallDTO,
  AiFeature,
  AiUsageDTO,
} from "@nimbus/types";
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
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  filters: UsageFilters;
  setFilters: (next: UsageFilters) => void;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
};

/** Page size requested from the server. */
const PAGE_SIZE = 25;

function usagePath(
  workspaceId: string,
  filters: UsageFilters,
  cursor: string | null,
): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<UsageFilters>({});
  // Guards against an older response landing after a newer filter change.
  const generation = useRef(0);

  const loadFirst = useCallback(async () => {
    if (!enabled) return;
    const mine = ++generation.current;
    setLoading(true);
    setError(null);
    const result = await aiApi<AiUsageDTO>(
      usagePath(workspaceId, filters, null),
      {},
      "Could not load usage. Please try again.",
    );
    if (mine !== generation.current) return;
    if (result.ok) {
      setCalls(result.data.calls);
      setTotals(result.data.totals);
      setNextCursor(result.data.nextCursor);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, [workspaceId, filters, enabled]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const mine = generation.current;
    setLoadingMore(true);
    setError(null);
    const result = await aiApi<AiUsageDTO>(
      usagePath(workspaceId, filters, nextCursor),
      {},
      "Could not load more calls. Please try again.",
    );
    if (mine !== generation.current) return;
    if (result.ok) {
      setCalls((prev) => [...prev, ...result.data.calls]);
      setNextCursor(result.data.nextCursor);
    } else {
      setError(result.message);
    }
    setLoadingMore(false);
  }, [workspaceId, filters, nextCursor]);

  return {
    calls,
    totals,
    nextCursor,
    loading,
    loadingMore,
    error,
    filters,
    setFilters,
    loadMore,
    refresh: loadFirst,
  };
}
