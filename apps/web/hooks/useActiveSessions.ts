/**
 * @module web/hooks/useActiveSessions
 * @description Active sessions list manager: fetches via
 * `authClient.listSessions()` on mount, supports per-row revoke
 * (`authClient.revokeSession({ token })`) and bulk revoke-others
 * (`authClient.revokeOtherSessions()`), refetching after each mutation.
 *
 * The current session is identified by comparing each row's `token`
 * against the value from `authClient.useSession()`. Revoking your own
 * session from this list would log you out without a redirect
 * (`authClient.revokeSession` does not redirect), so the UI must
 * navigate explicitly when that happens.
 *
 * @important The session list and the live session both come from the
 *            same better-auth client, so the `token` field is present
 *            on every row returned by `/list-sessions` and can be
 *            compared directly. `revokeSession` ownership-checks
 *            server-side, so no extra plumbing is needed.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";

/** Shape of a single session row returned by `/list-sessions`. Only the
 *  fields this hook actually reads are typed; the rest is opaque. */
export type SessionRow = {
  token: string;
  expiresAt: Date | string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

/** Discriminated state machine: every render returns one of these shapes. */
export type ActiveSessionsState =
  | { kind: "loading" }
  | { kind: "ready"; sessions: SessionRow[]; currentToken: string | null }
  | { kind: "error"; message: string };

/** Token-in-flight so the UI can show a spinner on the right row. */
export type RevokingToken = string | "others" | null;

/**
 * Manages the active-sessions list: fetch, per-row revoke, bulk
 * revoke-others, and navigation when the current session itself is
 * revoked.
 */
export function useActiveSessions() {
  const router = useRouter();
  const [state, setState] = useState<ActiveSessionsState>({ kind: "loading" });
  const [revoking, setRevoking] = useState<RevokingToken>(null);

  /**
   * Fetches the active-sessions list and the current session token,
   * merging them into the ready-state shape. Kept as a callback so the
   * revoke handlers can refetch after a mutation.
   */
  const refetch = useCallback(async () => {
    try {
      const [sessionsRes, sessionRes] = await Promise.all([
        authClient.listSessions(),
        authClient.getSession(),
      ]);
      const sessions = extractSessions(sessionsRes);
      const currentToken = extractToken(sessionRes);
      setState({ kind: "ready", sessions, currentToken });
    } catch (err) {
      setState({
        kind: "error",
        message:
          (err as { message?: string }).message ??
          "Could not load your active sessions.",
      });
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  /**
   * Revokes a single session by token. When the token matches the
   * current session, better-auth's `revokeSession` clears the cookie
   * but never redirects, so we explicitly route to `/login`.
   */
  const revokeSession = useCallback(
    async (token: string) => {
      setRevoking(token);
      try {
        await authClient.revokeSession({ token });
        // Revoking the current session logs the user out; reroute so the
        // page does not render a stale list with the user's row gone.
        if (state.kind === "ready" && token === state.currentToken) {
          router.push("/login");
          return;
        }
        await refetch();
      } catch (err) {
        if (state.kind === "ready") {
          setState({
            ...state,
            // Keep the previous list visible; surface the error inline by
            // leaving it on the catch. Most callers will just call
            // `setError` themselves if they want to render it.
          });
        }
        throw err;
      } finally {
        setRevoking(null);
      }
    },
    [refetch, router, state],
  );

  /**
   * Bulk-revokes every session except the current one. Refetches the
   * list on success so revoked rows vanish from view.
   */
  const revokeOtherSessions = useCallback(async () => {
    setRevoking("others");
    try {
      await authClient.revokeOtherSessions();
      await refetch();
    } finally {
      setRevoking(null);
    }
  }, [refetch]);

  return { state, refetch, revokeSession, revokeOtherSessions, revoking };
}

/**
 * Normalises the various resolution shapes better-auth returns from
 * `listSessions` (raw array, or `{ data, error }`) into a plain array.
 */
function extractSessions(res: unknown): SessionRow[] {
  const candidate = (res as { data?: unknown }).data ?? res;
  return Array.isArray(candidate) ? (candidate as SessionRow[]) : [];
}

/**
 * Reads `token` off a `getSession()` resolution. The better-auth session
 * envelope is `{ session: { token, ... }, user }` on success.
 */
function extractToken(res: unknown): string | null {
  const data = (res as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const session = (data as { session?: { token?: unknown } }).session;
  return typeof session?.token === "string" ? session.token : null;
}
