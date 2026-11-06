/**
 * @module web/hooks/useWorkspaceAiCredentials
 * @description Manages the workspace's saved AI credentials: list, add/replace,
 * and remove. Only admins may call these routes, so the list is fetched only
 * when `enabled` is true; a member's panel never triggers a 403.
 *
 * Saving calls `POST /api/ai/workspaces/:workspaceId/credentials`, which probes
 * the provider before persisting. A failed probe resolves to an error here
 * rather than throwing, so the dialog can render the message inline. A save that
 * succeeded but could not verify an audio kind comes back `ok` with `warnings`.
 *
 * @important Never read the plaintext key from the response. The endpoint only
 *            ever returns a `maskedPreview`, and the hook's API never exposes the
 *            input key after submit; the form is responsible for clearing it.
 */
import type {
  AiCredentialDTO,
  AiCredentialSaveDTO,
  AiProviderId,
} from "@nimbus/types";
import { useCallback, useEffect, useState } from "react";
import { aiApi, workspaceAiPath } from "../lib/aiApi";

export type WorkspaceCredentialsState =
  | { kind: "loading" }
  | { kind: "ready"; credentials: AiCredentialDTO[] }
  | { kind: "error"; message: string };

export type UseWorkspaceAiCredentials = {
  state: WorkspaceCredentialsState;
  /** Sends `POST …/credentials`. Resolves to the saved DTO or a message. */
  save: (input: {
    providerId: AiProviderId;
    apiKey: string;
    label?: string;
  }) => Promise<
    | { ok: true; credential: AiCredentialSaveDTO; warnings: string[] }
    | { ok: false; message: string }
  >;
  /** Sends `DELETE …/credentials/:providerId`. */
  remove: (
    providerId: AiProviderId,
  ) => Promise<
    | { ok: true; clearedPreferences: number }
    | { ok: false; message: string }
  >;
  /** Triggers a refetch. */
  refresh: () => Promise<void>;
};

/**
 * Reads the workspace's saved credentials and exposes add/remove.
 *
 * @param workspaceId - The workspace cuid.
 * @param enabled - Whether the caller may list credentials (admin or owner).
 * @returns The discriminated state and the save/remove/refresh handlers.
 */
export function useWorkspaceAiCredentials(
  workspaceId: string,
  enabled = true,
): UseWorkspaceAiCredentials {
  const [state, setState] = useState<WorkspaceCredentialsState>(
    enabled ? { kind: "loading" } : { kind: "ready", credentials: [] },
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const result = await aiApi<AiCredentialDTO[]>(
      workspaceAiPath(workspaceId, "/credentials"),
      {},
      "Could not load credentials. Please try again.",
    );
    setState(
      result.ok
        ? { kind: "ready", credentials: result.data ?? [] }
        : { kind: "error", message: result.message },
    );
  }, [workspaceId, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: { providerId: AiProviderId; apiKey: string; label?: string }) => {
      const result = await aiApi<AiCredentialSaveDTO>(
        workspaceAiPath(workspaceId, "/credentials"),
        { method: "POST", body: input },
        "Could not save the credential. Please try again.",
      );
      if (!result.ok || !result.data) {
        return {
          ok: false as const,
          message: result.ok
            ? "Could not save the credential. Please try again."
            : result.message,
        };
      }
      await refresh();
      return {
        ok: true as const,
        credential: result.data,
        warnings: result.data.warnings ?? [],
      };
    },
    [workspaceId, refresh],
  );

  const remove = useCallback(
    async (providerId: AiProviderId) => {
      const result = await aiApi<{ clearedPreferences: number }>(
        workspaceAiPath(workspaceId, `/credentials/${providerId}`),
        { method: "DELETE" },
        "Could not remove the credential. Please try again.",
      );
      if (!result.ok) return { ok: false as const, message: result.message };
      await refresh();
      return {
        ok: true as const,
        clearedPreferences: result.data?.clearedPreferences ?? 0,
      };
    },
    [workspaceId, refresh],
  );

  return { state, save, remove, refresh };
}
