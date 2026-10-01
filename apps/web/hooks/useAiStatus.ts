/**
 * @module web/hooks/useAiStatus
 * @description Loads `/api/ai/status` and exposes a discriminated
 * `loading | ready | error` state for the chat composer and the AI
 * settings panel.
 *
 * `refresh()` lets a parent refetch — the panel uses it after credential
 * add/remove so the disabled-branch decisions update without a hard reload.
 * The composer also refetches on socket `connect` (Phase 8 wires that).
 *
 * @important The DTO is the source of truth for whether the composer is
 *            disabled — `chat.enabled === false` is the only signal the
 *            chat composer needs. Do not derive it locally from
 *            `credentials.length` or any other field.
 */
import type {
  AiStatusDTO,
} from "@nimbus/types";
import { useCallback, useEffect, useState } from "react";

type StatusState =
  | { kind: "loading" }
  | { kind: "ready"; status: AiStatusDTO }
  | { kind: "error"; message: string };

export type UseAiStatus = {
  state: StatusState;
  /** Triggers a refetch. Resolves when the refetch settles. */
  refresh: () => Promise<void>;
};

/**
 * Reads `/api/ai/status`. Resolves on the success or failure of the first
 * request, then on each call to `refresh()`.
 *
 * @returns The discriminated status state and a `refresh` callback.
 */
export function useAiStatus(): UseAiStatus {
  const [state, setState] = useState<StatusState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ai/status`,
        { credentials: "include" },
      );
      const body = (await res.json()) as {
        success: boolean;
        message?: string;
        responseObject?: AiStatusDTO;
      };

      if (!res.ok || !body.success || !body.responseObject) {
        setState({
          kind: "error",
          message:
            body.message ?? "Could not load AI status. Please try again.",
        });
        return;
      }

      setState({ kind: "ready", status: body.responseObject });
    } catch (err) {
      setState({
        kind: "error",
        message:
          (err as { message?: string }).message ??
          "Could not load AI status. Please try again.",
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, refresh };
}
