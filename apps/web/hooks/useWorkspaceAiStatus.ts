/**
 * @module web/hooks/useWorkspaceAiStatus
 * @description Loads `GET /api/ai/workspaces/:workspaceId/status` and exposes a
 * discriminated `loading | ready | error` state for the chat composer and the
 * workspace AI tab.
 *
 * `refresh()` lets a parent refetch: the AI tab uses it after a key, model or
 * setting changes, and the composer uses it on socket reconnect.
 *
 * @important The DTO is the source of truth for whether the composer is
 *            disabled: `features.chat.enabled === false` is the only signal the
 *            composer needs, and `canManage` the only signal for whether to
 *            offer key management. Do not derive either locally.
 */
import type { AiWorkspaceStatusDTO } from "@nimbus/types";
import { useCallback, useEffect, useState } from "react";
import { aiApi, workspaceAiPath } from "../lib/aiApi";

export type WorkspaceAiStatusState =
  | { kind: "loading" }
  | { kind: "ready"; status: AiWorkspaceStatusDTO }
  | { kind: "error"; message: string };

export type UseWorkspaceAiStatus = {
  state: WorkspaceAiStatusState;
  /** Triggers a refetch. Resolves when the refetch settles. */
  refresh: () => Promise<void>;
};

/**
 * Reads the workspace's AI status. Resolves on the success or failure of the
 * first request, then on each call to `refresh()`.
 *
 * @param workspaceId - The workspace cuid.
 * @returns The discriminated status state and a `refresh` callback.
 */
export function useWorkspaceAiStatus(workspaceId: string): UseWorkspaceAiStatus {
  const [state, setState] = useState<WorkspaceAiStatusState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    const result = await aiApi<AiWorkspaceStatusDTO>(
      workspaceAiPath(workspaceId, "/status"),
      {},
      "Could not load AI status. Please try again.",
    );
    setState(
      result.ok
        ? { kind: "ready", status: result.data }
        : { kind: "error", message: result.message },
    );
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, refresh };
}
