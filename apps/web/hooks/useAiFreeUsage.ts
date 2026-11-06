/**
 * @module web/hooks/useAiFreeUsage
 * @description The caller's own free AI allowances, from
 * `GET /api/ai/me/free-usage`: documents and assistant seconds remaining, and
 * the workspaces they administer (where a key lifts the limits).
 *
 * Seeded with the server-rendered payload so the Free usage tab is answerable on
 * first paint; the fetch only refreshes it.
 */
import type { AiFreeUsageDTO } from "@nimbus/types";
import { useCallback, useEffect, useState } from "react";
import { aiApi } from "../lib/aiApi";

export type UseAiFreeUsage = {
  usage: AiFreeUsageDTO;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * @param initial - The server-rendered allowances.
 * @returns The latest allowances, the last error and a refresh handler.
 */
export function useAiFreeUsage(initial: AiFreeUsageDTO): UseAiFreeUsage {
  const [usage, setUsage] = useState<AiFreeUsageDTO>(initial);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await aiApi<AiFreeUsageDTO>(
      "/api/ai/me/free-usage",
      {},
      "Could not load your free usage. Please try again.",
    );
    if (result.ok) {
      setUsage(result.data);
      setError(null);
    } else {
      setError(result.message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { usage, error, refresh };
}
