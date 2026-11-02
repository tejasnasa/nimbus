/**
 * @module web/hooks/useAiCatalog
 * @description OpenRouter's live model catalogue for one feature, read from
 * `GET /api/ai/catalog/openrouter?feature=`.
 *
 * The fetch runs only while `enabled` is true, so a user without an OpenRouter
 * key never triggers it. A failure is returned as a message and leaves the list
 * empty: the picker still offers the registry's own models, so an unreachable
 * catalogue degrades the dropdown rather than emptying it.
 */
import type { AiCatalogDTO, AiCatalogModelDTO, AiFeature } from "@nimbus/types";
import { useEffect, useState } from "react";

type CatalogState = {
  models: AiCatalogModelDTO[];
  loading: boolean;
  /** True when the server answered from a stale cached copy. */
  stale: boolean;
  error: string | null;
};

/**
 * @param feature - The feature whose hard requirements filter the list.
 * @param enabled - Whether to fetch at all.
 * @returns The catalogue models and the fetch status.
 */
export function useAiCatalog(feature: AiFeature, enabled: boolean): CatalogState {
  const [state, setState] = useState<CatalogState>({
    models: [],
    loading: false,
    stale: false,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ai/catalog/openrouter?feature=${feature}`,
          { credentials: "include" },
        );
        const body = (await res.json()) as {
          success: boolean;
          message?: string;
          responseObject?: AiCatalogDTO;
        };
        if (cancelled) return;
        if (!res.ok || !body.success || !body.responseObject) {
          setState({
            models: [],
            loading: false,
            stale: false,
            error: body.message ?? "Could not load the OpenRouter model list.",
          });
          return;
        }
        setState({
          models: body.responseObject.models,
          loading: false,
          stale: body.responseObject.stale,
          error: null,
        });
      } catch {
        if (cancelled) return;
        setState({
          models: [],
          loading: false,
          stale: false,
          error: "Could not load the OpenRouter model list.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [feature, enabled]);

  return state;
}
