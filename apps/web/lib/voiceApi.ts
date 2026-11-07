/**
 * @module web/lib/voiceApi
 * @description Client call for the one authenticated voice endpoint the browser
 * needs: the token that admits it to a workspace's call.
 *
 * Failures resolve to `{ ok: false, message }` rather than throwing, matching
 * `lib/aiApi`, so the provider can show the message inline.
 */

/** What the browser needs to connect to a workspace's call. */
export type VoiceTokenResult =
  | { ok: true; token: string; url: string; roomName: string }
  | { ok: false; message: string; status: number };

const FALLBACK = "Couldn't join the call. Please try again.";

/**
 * Asks the API for a call token.
 *
 * @param workspaceId - The workspace whose call to join.
 * @returns The token and media server URL, or a message safe to show.
 */
export async function fetchVoiceToken(
  workspaceId: string,
): Promise<VoiceTokenResult> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/voice/token`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      },
    );
    const body = (await res.json()) as {
      success?: boolean;
      message?: string;
      responseObject?: { token: string; url: string; roomName: string };
    };
    if (!res.ok || !body.success || !body.responseObject) {
      return { ok: false, message: body.message || FALLBACK, status: res.status };
    }
    return { ok: true, ...body.responseObject };
  } catch {
    return { ok: false, message: FALLBACK, status: 0 };
  }
}
