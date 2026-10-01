/**
 * @module web/hooks/useAiPreferences
 * @description Per-feature provider/model preference save. Each feature has its
 * own pending and error state so saving one does not lock or reset another.
 *
 * The picker's "saving is immediate on change" requirement means there is no
 * `isDirty`/`save()` distinction in the public API: `save({...})` is the call,
 * the hook tracks `pending` per feature, and the picker renders the previous
 * value as a fallback while the new one is in flight.
 *
 * @important Failures render inline (never `alert()`, and this app has no
 *            toast library). The picker shows the message in place.
 */
import type { AiFeature, AiPreferenceDTO } from "@nimbus/types";
import { useCallback, useEffect, useState } from "react";

type PreferencesState =
  | { kind: "loading" }
  | { kind: "ready"; preferences: Record<AiFeature, AiPreferenceDTO | null> }
  | { kind: "error"; message: string };

export type UseAiPreferences = {
  state: PreferencesState;
  /**
   * `pending` is the feature currently being saved, or `null`. The picker
   * uses it to disable the dropdown it just changed while the call lands.
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
 * Reads the caller's per-feature preferences and exposes `save({...})`.
 *
 * @returns The discriminated state, the pending feature, the last error, and
 *          the save/refresh handlers.
 */
export function useAiPreferences(): UseAiPreferences {
  const [state, setState] = useState<PreferencesState>({ kind: "loading" });
  const [pending, setPending] = useState<AiFeature | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ai/preferences`,
        { credentials: "include" },
      );
      const body = (await res.json()) as {
        success: boolean;
        message?: string;
        responseObject?: Record<AiFeature, AiPreferenceDTO | null>;
      };
      if (!res.ok || !body.success) {
        setState({
          kind: "error",
          message:
            body.message ?? "Could not load preferences. Please try again.",
        });
        return;
      }
      setState({
        kind: "ready",
        preferences:
          body.responseObject ?? { chat: null, markdown: null, canvas: null },
      });
    } catch (err) {
      setState({
        kind: "error",
        message:
          (err as { message?: string }).message ??
          "Could not load preferences. Please try again.",
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: AiPreferenceDTO) => {
      setPending(input.feature);
      setError(null);
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ai/preferences`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify(input),
          },
        );
        const body = (await res.json()) as {
          success: boolean;
          message?: string;
        };
        if (!res.ok || !body.success) {
          setError(
            body.message ?? "Could not save the preference. Please try again.",
          );
          setPending(null);
          return { ok: false as const, message: body.message ?? "" };
        }
        await refresh();
        setPending(null);
        return { ok: true as const };
      } catch (err) {
        const message =
          (err as { message?: string }).message ??
          "Could not save the preference. Please try again.";
        setError(message);
        setPending(null);
        return { ok: false as const, message };
      }
    },
    [refresh],
  );

  return { state, pending, error, save, refresh };
}
