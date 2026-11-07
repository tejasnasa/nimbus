/**
 * @module web/api/voice
 * @description Server-side fetch helper for the call roster, so the workspace
 * page can paint who is on the call before the socket delivers its first update.
 *
 * @important Failures resolve to an empty roster rather than throwing: the call
 *            is optional, and the page must not 500 because the roster
 *            endpoint did. The socket's `voice:roster` corrects it on connect.
 */
import { VoiceUser } from "@nimbus/types";
import { headers } from "next/headers";

/**
 * Reads who is on a workspace's call.
 *
 * @param workspaceId - The workspace cuid.
 * @returns The roster, or an empty one when the API cannot be reached.
 */
export async function getVoiceRoster(workspaceId: string): Promise<VoiceUser[]> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/voice/${encodeURIComponent(workspaceId)}/roster`,
      {
        headers: { cookie: (await headers()).get("cookie") ?? "" },
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as {
      success?: boolean;
      responseObject?: { users?: VoiceUser[] };
    };
    return body.success ? (body.responseObject?.users ?? []) : [];
  } catch {
    return [];
  }
}
