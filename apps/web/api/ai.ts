/**
 * @module web/api/ai
 * @description Server-side AI fetch helpers. Forward the request cookies to the
 * API (session auth) with `cache: "no-store"` so a page can render its AI
 * surface without waiting on a hook's fetch.
 *
 * `@important` Failures resolve to a disabled-everything shape rather than
 * throwing: the AI panels render their own error UI, and the page itself must
 * not 500 because the AI endpoint did.
 */
import { headers } from "next/headers";
import {
  AI_FEATURES,
  type AiFeature,
  type AiFeatureStatus,
  type AiFreeUsageDTO,
  type AiWorkspaceStatusDTO,
} from "@nimbus/types";

const OFF: AiFeatureStatus = {
  enabled: false,
  providerId: null,
  modelId: null,
  substituted: false,
  reason: null,
};

/** Empty shape used when the API is unreachable or returns a non-OK status. */
const FALLBACK_STATUS: AiWorkspaceStatusDTO = {
  features: Object.fromEntries(
    AI_FEATURES.map((f) => [f, { ...OFF }]),
  ) as Record<AiFeature, AiFeatureStatus>,
  voice: { available: false, reason: null, speaks: false },
  free: {
    docsRemaining: 0,
    docsLimit: 0,
    voiceSecondsRemaining: 0,
    voiceSecondsLimit: 0,
    docsState: "unconfigured",
    voiceState: "unconfigured",
  },
  canManage: false,
};

/** Empty shape for the account-level Free usage tab. */
const FALLBACK_FREE_USAGE: AiFreeUsageDTO = {
  ...FALLBACK_STATUS.free,
  adminWorkspaces: [],
};

/** GETs an enveloped payload with the caller's cookies, or `null` on any failure. */
async function getEnveloped<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}${path}`, {
      headers: { cookie: (await headers()).get("cookie") ?? "" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      success: boolean;
      responseObject?: T;
    };
    return body.success && body.responseObject ? body.responseObject : null;
  } catch {
    // The AI panels handle their own errors and the page must not crash on a
    // fetch failure.
    return null;
  }
}

/**
 * Reads a workspace's AI status server-side. Resolves with the same shape the
 * client hook returns, or a "nothing available" fallback when the API is
 * unreachable so the workspace page can still render.
 *
 * @param workspaceId - The workspace cuid.
 */
export async function getAiStatus(
  workspaceId: string,
): Promise<AiWorkspaceStatusDTO> {
  return (
    (await getEnveloped<AiWorkspaceStatusDTO>(
      `/api/ai/workspaces/${encodeURIComponent(workspaceId)}/status`,
    )) ?? FALLBACK_STATUS
  );
}

/**
 * Reads the caller's free allowances and administered workspaces server-side,
 * for the account Free usage tab.
 */
export async function getFreeUsage(): Promise<AiFreeUsageDTO> {
  return (
    (await getEnveloped<AiFreeUsageDTO>("/api/ai/me/free-usage")) ??
    FALLBACK_FREE_USAGE
  );
}
