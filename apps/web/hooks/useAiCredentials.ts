/**
 * @module web/hooks/useAiCredentials
 * @description Manages the user's saved AI credentials: list, add/replace, and
 * remove. State is local to the panel rather than going through the global
 * status cache, because adding or removing a key is the panel's own event and
 * it can refetch itself without forcing the rest of the app to redraw.
 *
 * Saving a credential calls `POST /api/ai/credentials`, which probes the
 * upstream provider before persisting. A failed probe resolves to an error
 * here rather than throwing, so the dialog can render the message inline.
 *
 * @important Never read the plaintext key from the response. The endpoint
 *            only ever returns a `maskedPreview`, and the hook's API never
 *            exposes the input key after submit — the form is responsible
 *            for clearing it.
 */
import type {
  AiCredentialDTO,
  AiProviderId,
} from "@nimbus/types";
import { useCallback, useEffect, useState } from "react";

type CredentialsState =
  | { kind: "loading" }
  | { kind: "ready"; credentials: AiCredentialDTO[] }
  | { kind: "error"; message: string };

export type UseAiCredentials = {
  state: CredentialsState;
  /** Sends `POST /api/ai/credentials`. Resolves to the saved DTO. */
  save: (input: {
    providerId: AiProviderId;
    apiKey: string;
    label?: string;
  }) => Promise<{ ok: true; credential: AiCredentialDTO } | { ok: false; message: string }>;
  /** Sends `DELETE /api/ai/credentials/:providerId`. */
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
 * Reads the caller's saved credentials and exposes add/remove.
 *
 * @returns The discriminated state and the save/remove/refresh handlers.
 */
export function useAiCredentials(): UseAiCredentials {
  const [state, setState] = useState<CredentialsState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ai/credentials`,
        { credentials: "include" },
      );
      const body = (await res.json()) as {
        success: boolean;
        message?: string;
        responseObject?: AiCredentialDTO[];
      };

      if (!res.ok || !body.success) {
        setState({
          kind: "error",
          message:
            body.message ?? "Could not load credentials. Please try again.",
        });
        return;
      }

      setState({ kind: "ready", credentials: body.responseObject ?? [] });
    } catch (err) {
      setState({
        kind: "error",
        message:
          (err as { message?: string }).message ??
          "Could not load credentials. Please try again.",
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: { providerId: AiProviderId; apiKey: string; label?: string }) => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ai/credentials`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify(input),
          },
        );
        const body = (await res.json()) as {
          success: boolean;
          message?: string;
          responseObject?: AiCredentialDTO;
        };
        if (!res.ok || !body.success || !body.responseObject) {
          return {
            ok: false as const,
            message:
              body.message ?? "Could not save the credential. Please try again.",
          };
        }
        // Refresh the list so the panel reflects the new row.
        await refresh();
        return { ok: true as const, credential: body.responseObject };
      } catch (err) {
        return {
          ok: false as const,
          message:
            (err as { message?: string }).message ??
            "Could not save the credential. Please try again.",
        };
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (providerId: AiProviderId) => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ai/credentials/${providerId}`,
          { method: "DELETE", credentials: "include" },
        );
        const body = (await res.json()) as {
          success: boolean;
          message?: string;
          responseObject?: { clearedPreferences: number };
        };
        if (!res.ok || !body.success) {
          return {
            ok: false as const,
            message:
              body.message ??
              "Could not remove the credential. Please try again.",
          };
        }
        await refresh();
        return {
          ok: true as const,
          clearedPreferences: body.responseObject?.clearedPreferences ?? 0,
        };
      } catch (err) {
        return {
          ok: false as const,
          message:
            (err as { message?: string }).message ??
            "Could not remove the credential. Please try again.",
        };
      }
    },
    [refresh],
  );

  return { state, save, remove, refresh };
}
