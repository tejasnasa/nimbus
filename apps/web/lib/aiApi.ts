/**
 * @module web/lib/aiApi
 * @description The one fetch wrapper the workspace AI hooks share: sends the
 * session cookie, reads the `ServerResponse` envelope, and turns every failure
 * (network, non-2xx, `success: false`, malformed body) into a returned
 * `{ ok: false, message }` rather than a throw.
 *
 * Hooks render these messages inline; none of them uses `alert()`, and this app
 * has no toast library.
 */

/** The outcome of an API call. */
export type AiApiResult<T> =
  | { ok: true; data: T; message: string }
  | { ok: false; message: string; status: number };

/** Path of a route under `/api/ai/workspaces/:workspaceId`. */
export const workspaceAiPath = (workspaceId: string, suffix = ""): string =>
  `/api/ai/workspaces/${encodeURIComponent(workspaceId)}${suffix}`;

/**
 * Calls the API and unwraps the envelope.
 *
 * @param path - Path beginning with `/api/…`; joined to `NEXT_PUBLIC_BACKEND_URL`.
 * @param init - Method and optional JSON body.
 * @param fallback - Message used when the server supplied none.
 */
export async function aiApi<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  fallback = "Something went wrong. Please try again.",
): Promise<AiApiResult<T>> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      ...(init.body !== undefined && {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(init.body),
      }),
    });
    const body = (await res.json()) as {
      success?: boolean;
      message?: string;
      responseObject?: T;
    };
    if (!res.ok || !body.success) {
      return {
        ok: false,
        message: body.message || fallback,
        status: res.status,
      };
    }
    return {
      ok: true,
      data: body.responseObject as T,
      message: body.message ?? "",
    };
  } catch (err) {
    return {
      ok: false,
      message: (err as { message?: string }).message || fallback,
      status: 0,
    };
  }
}
