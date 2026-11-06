/**
 * @module web/hooks/useWorkspaceAiPreferences
 * @description Per-feature provider/model preference save for a workspace. Each
 * feature has its own pending and error state so saving one does not lock or
 * reset another.
 *
 * The picker's "saving is immediate on change" requirement means there is no
 * `isDirty`/`save()` distinction in the public API: `save({...})` is the call,
 * the hook tracks `pending` per feature, and the picker renders the previous
 * value as a fallback while the new one is in flight.
 *
 * @important Failures render inline (never `alert()`, and this app has no
 *            toast library). The picker shows the message in place.
 */
import { AI_FEATURES, type AiFeature, type AiPreferenceDTO } from "@nimbus/types";
import { useCallback, useEffect, useState } from "react";
import { aiApi, workspaceAiPath } from "../lib/aiApi";

export type PreferenceMap = Record<AiFeature, AiPreferenceDTO | null>;

type PreferencesState =
  | { kind: "loading" }
  | { kind: "ready"; preferences: PreferenceMap }
  | { kind: "error"; message: string };

/** A map with no preference for any feature. */
export const emptyPreferences = (): PreferenceMap =>
  Object.fromEntries(AI_FEATURES.map((f) => [f, null])) as PreferenceMap;

export type UseWorkspaceAiPreferences = {
  state: PreferencesState;
  /**
   * `pending` is the feature currently being saved, or `null`. The picker uses
   * it to disable the dropdown it just changed while the call lands.
   */
  pending: AiFeature | null;
  /** The error from the most recent save, or `null`. Cleared on next save. */
  error: string | null;
  save: (
    input: AiPreferenceDTO,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  refresh: () => Promise<void>;
};

/**
 * Reads the workspace's per-feature preferences and exposes `save({...})`.
 *
 * @param workspaceId - The workspace cuid.
 * @returns The discriminated state, the pending feature, the last error, and
 *          the save/refresh handlers.
 */
export function useWorkspaceAiPreferences(
  workspaceId: string,
): UseWorkspaceAiPreferences {
  const [state, setState] = useState<PreferencesState>({ kind: "loading" });
  const [pending, setPending] = useState<AiFeature | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await aiApi<PreferenceMap>(
      workspaceAiPath(workspaceId, "/preferences"),
      {},
      "Could not load preferences. Please try again.",
    );
    setState(
      result.ok
        ? {
            kind: "ready",
            preferences: { ...emptyPreferences(), ...(result.data ?? {}) },
          }
        : { kind: "error", message: result.message },
    );
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: AiPreferenceDTO) => {
      setPending(input.feature);
      setError(null);
      // The wire field is `source`. Capabilities are never sent: the server
      // copies or measures them itself.
      const result = await aiApi<AiPreferenceDTO>(
        workspaceAiPath(workspaceId, "/preferences"),
        {
          method: "PUT",
          body: {
            feature: input.feature,
            providerId: input.providerId,
            modelId: input.modelId,
            source: input.modelSource,
            ...(input.voice ? { voice: input.voice } : {}),
          },
        },
        "Could not save the preference. Please try again.",
      );
      if (!result.ok) {
        setError(result.message);
        setPending(null);
        return { ok: false as const, message: result.message };
      }
      await refresh();
      setPending(null);
      return { ok: true as const };
    },
    [workspaceId, refresh],
  );

  return { state, pending, error, save, refresh };
}
