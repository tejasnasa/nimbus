/**
 * @module web/hooks/useWorkspaceAiSettings
 * @description Reads and saves the workspace's AI settings: the monthly spend
 * cap and the assistant switches, with the month-to-date spend the server
 * reports beside the cap.
 *
 * Any member can read the settings (the read-only summary shows them); only
 * admins can save. A rejected save is returned as a message and the last good
 * values stay on screen.
 */
import type { AiWorkspaceSettingsDTO } from "@nimbus/types";
import { useCallback, useEffect, useState } from "react";
import { aiApi, workspaceAiPath } from "../lib/aiApi";

type SettingsState =
  | { kind: "loading" }
  | { kind: "ready"; settings: AiWorkspaceSettingsDTO }
  | { kind: "error"; message: string };

/** The fields a save may change; fields left out are unchanged. */
export type SettingsChange = {
  /** `null` removes the cap. */
  monthlySpendCapUsd?: number | null;
  assistantEnabled?: boolean;
  assistantSpeaks?: boolean;
};

export type UseWorkspaceAiSettings = {
  state: SettingsState;
  saving: boolean;
  save: (
    change: SettingsChange,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  refresh: () => Promise<void>;
};

/**
 * @param workspaceId - The workspace cuid.
 * @returns The settings state and the save/refresh handlers.
 */
export function useWorkspaceAiSettings(
  workspaceId: string,
): UseWorkspaceAiSettings {
  const [state, setState] = useState<SettingsState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const result = await aiApi<AiWorkspaceSettingsDTO>(
      workspaceAiPath(workspaceId, "/settings"),
      {},
      "Could not load AI settings. Please try again.",
    );
    setState(
      result.ok
        ? { kind: "ready", settings: result.data }
        : { kind: "error", message: result.message },
    );
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (change: SettingsChange) => {
      setSaving(true);
      const result = await aiApi<AiWorkspaceSettingsDTO>(
        workspaceAiPath(workspaceId, "/settings"),
        { method: "PUT", body: change },
        "Could not save the settings. Please try again.",
      );
      setSaving(false);
      if (!result.ok) return { ok: false as const, message: result.message };
      setState({ kind: "ready", settings: result.data });
      return { ok: true as const };
    },
    [workspaceId],
  );

  return { state, saving, save, refresh };
}
