/**
 * @module web/hooks/useAiModelProbe
 * @description Runs `POST /api/ai/models/probe` for a custom model id and keeps
 * the measured result, or the reason it was rejected, as inline state.
 *
 * The server measures with the caller's own stored key; nothing secret passes
 * through the browser. A refusal (wrong key, unknown id) comes back as a curated
 * message and is returned, never thrown.
 */
import type { AiProbeResultDTO, AiProviderId } from "@nimbus/types";
import { useCallback, useState } from "react";

export type UseAiModelProbe = {
  /** The latest measured result, or `null` before a check or after a failure. */
  result: AiProbeResultDTO | null;
  /** The curated reason the last check failed, or `null`. */
  error: string | null;
  checking: boolean;
  /** Probes the id; resolves to the measured result, or `null` on failure. */
  check: (
    providerId: AiProviderId,
    modelId: string,
  ) => Promise<AiProbeResultDTO | null>;
  /** Forgets the last result and error. */
  reset: () => void;
};

/** @returns The probe state and its `check` / `reset` handlers. */
export function useAiModelProbe(): UseAiModelProbe {
  const [result, setResult] = useState<AiProbeResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(
    async (providerId: AiProviderId, modelId: string) => {
      setChecking(true);
      setError(null);
      setResult(null);
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ai/models/probe`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ providerId, modelId }),
          },
        );
        const body = (await res.json()) as {
          success: boolean;
          message?: string;
          responseObject?: AiProbeResultDTO;
        };
        if (!res.ok || !body.success || !body.responseObject) {
          setError(body.message ?? "Could not check that model. Please try again.");
          return null;
        }
        setResult(body.responseObject);
        return body.responseObject;
      } catch {
        setError("Could not check that model. Please try again.");
        return null;
      } finally {
        setChecking(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, error, checking, check, reset };
}
