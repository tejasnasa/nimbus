/**
 * @module web/api/ai
 * @description Server-side AI status fetch helper. Forwards the request
 * cookies to the API (session auth) with `cache: "no-store"` so the settings
 * page can render the AI tab without waiting on a `useAiStatus` fetch.
 *
 * `@important` Failures resolve to a graceful "BYOK unavailable, free tier
 * unconfigured" shape rather than throwing — the AI panel renders its own
 * error UI, and the page itself must not 500 because the AI endpoint did.
 */
import { headers } from "next/headers";
import type { AiStatusDTO } from "@nimbus/types";

/** Empty shape used when the API is unreachable or returns a non-OK status. */
const FALLBACK: AiStatusDTO = {
  byokAvailable: false,
  chat: {
    enabled: false,
    providerId: null,
    modelId: null,
    substituted: false,
  },
  documents: {
    markdown: {
      enabled: false,
      providerId: null,
      modelId: null,
      substituted: false,
    },
    canvas: {
      enabled: false,
      providerId: null,
      modelId: null,
      substituted: false,
    },
    freeRemaining: 0,
    freeLimit: 0,
    freeTierState: "unconfigured",
  },
  credentials: [],
  preferences: { chat: null, markdown: null, canvas: null },
};

/**
 * Reads the caller's AI status server-side. Resolves with the same shape the
 * client hook returns, or a "BYOK unavailable, free tier unconfigured"
 * fallback when the API is unreachable so the settings page can still render.
 *
 * @returns The status payload, or the fallback when the API is unreachable.
 */
export async function getAiStatus(): Promise<AiStatusDTO> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ai/status`,
      {
        headers: { cookie: (await headers()).get("cookie") ?? "" },
        cache: "no-store",
      },
    );

    if (!res.ok) return FALLBACK;

    const body = (await res.json()) as {
      success: boolean;
      responseObject?: AiStatusDTO;
    };

    return body.success && body.responseObject ? body.responseObject : FALLBACK;
  } catch {
    // Same reasoning as the !res.ok branch — the AI panel handles its own
    // errors and the settings page must not crash on a fetch failure.
    return FALLBACK;
  }
}
