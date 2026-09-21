/**
 * @module web/tests/unit/hooks/useActiveSessions
 * @description Active-sessions list manager:
 *  - lists rows from a mocked `listSessions`
 *  - flags the current session (whose token matches `getSession`) and
 *    disables its revoke button's call from the hook's perspective (the
 *    component layer enforces the disabled visual; the hook itself
 *    routes to `/login` if `revokeSession` is called for the current
 *    row)
 *  - calls `revokeSession({ token })` for non-current rows and refetches
 *  - bulk `revokeOtherSessions` and refetches
 *  - navigates to `/login` when the current session itself is revoked
 *
 * Uses `authClient` mock pattern matching the rest of the suite. The
 * `useSession` hook is *not* used (only `getSession`) — the current
 * session is read once per refetch via `getSession`, which keeps the
 * hook stable across re-renders.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  listSessionsMock,
  getSessionMock,
  revokeSessionMock,
  revokeOtherSessionsMock,
} = vi.hoisted(() => ({
  listSessionsMock: vi.fn(),
  getSessionMock: vi.fn(),
  revokeSessionMock: vi.fn(),
  revokeOtherSessionsMock: vi.fn(),
}));

const { routerMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("../../../lib/auth-client", () => ({
  authClient: {
    listSessions: listSessionsMock,
    getSession: getSessionMock,
    revokeSession: revokeSessionMock,
    revokeOtherSessions: revokeOtherSessionsMock,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import { useActiveSessions } from "../../../hooks/useActiveSessions";

const ROW_A = {
  token: "token-A",
  userId: "user-1",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  ipAddress: "203.0.113.10",
  userAgent: "Mozilla/5.0 Chrome/120 Mac OS",
  createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
};

const ROW_B = {
  token: "token-B",
  userId: "user-1",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  ipAddress: "203.0.113.20",
  userAgent: "Mozilla/5.0 Firefox/121 Windows",
  createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 60 * 1000).toISOString(),
};

/** Builds a `getSession` resolution whose session token matches the given value. */
const sessionWithToken = (token: string) => ({
  data: { session: { token }, user: { id: "user-1" } },
  error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  routerMock.push.mockClear();
  routerMock.refresh.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useActiveSessions", () => {
  describe("loading and ready states", () => {
    it("starts in the loading state and transitions to ready", async () => {
      listSessionsMock.mockResolvedValue([ROW_A]);
      getSessionMock.mockResolvedValue(sessionWithToken("token-A"));

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      if (result.current.state.kind !== "ready") return;

      expect(result.current.state.sessions).toHaveLength(1);
      expect(result.current.state.sessions[0]?.token).toBe("token-A");
      expect(result.current.state.currentToken).toBe("token-A");
    });

    it("accepts the alternative `{ data: [...] }` resolution shape from listSessions", async () => {
      listSessionsMock.mockResolvedValue({ data: [ROW_A, ROW_B] });
      getSessionMock.mockResolvedValue(sessionWithToken("token-A"));

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      if (result.current.state.kind !== "ready") return;
      expect(result.current.state.sessions).toHaveLength(2);
    });

    it("falls back to an empty list when listSessions resolves to a non-array", async () => {
      listSessionsMock.mockResolvedValue({ unexpected: true });
      getSessionMock.mockResolvedValue(sessionWithToken("token-A"));

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      if (result.current.state.kind !== "ready") return;
      expect(result.current.state.sessions).toEqual([]);
    });

    it("reports an error state when listSessions rejects", async () => {
      listSessionsMock.mockRejectedValue({ message: "Network down" });

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("error"));
      if (result.current.state.kind !== "error") return;
      expect(result.current.state.message).toBe("Network down");
    });

    it("falls back to a generic message when the error has no `.message`", async () => {
      listSessionsMock.mockRejectedValue({});

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("error"));
      if (result.current.state.kind !== "error") return;
      expect(result.current.state.message).toBe(
        "Could not load your active sessions.",
      );
    });
  });

  describe("current session detection", () => {
    it("flags a row whose token matches the current session token", async () => {
      listSessionsMock.mockResolvedValue([ROW_A, ROW_B]);
      getSessionMock.mockResolvedValue(sessionWithToken("token-A"));

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      if (result.current.state.kind !== "ready") return;

      // Capture into locals so the `.find` callbacks do not re-read
      // `result.current.state` and lose the discriminated narrowing.
      const { sessions, currentToken } = result.current.state;
      const current = sessions.find((s) => s.token === currentToken);
      const other = sessions.find((s) => s.token !== currentToken);
      expect(current?.token).toBe("token-A");
      expect(other?.token).toBe("token-B");
    });

    it("treats a missing current session token as no current row", async () => {
      listSessionsMock.mockResolvedValue([ROW_A, ROW_B]);
      getSessionMock.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      if (result.current.state.kind !== "ready") return;
      expect(result.current.state.currentToken).toBeNull();
    });
  });

  describe("revokeSession", () => {
    it("calls revokeSession with the right token and refetches", async () => {
      listSessionsMock
        .mockResolvedValueOnce([ROW_A, ROW_B])
        .mockResolvedValueOnce([ROW_A]);
      getSessionMock.mockResolvedValue(sessionWithToken("token-A"));
      revokeSessionMock.mockResolvedValue({ data: { status: true } });

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      if (result.current.state.kind !== "ready") return;

      await act(async () => {
        await result.current.revokeSession("token-B");
      });

      expect(revokeSessionMock).toHaveBeenCalledTimes(1);
      expect(revokeSessionMock).toHaveBeenCalledWith({ token: "token-B" });
      expect(routerMock.push).not.toHaveBeenCalled();

      await waitFor(() => {
        if (result.current.state.kind !== "ready") return;
        expect(result.current.state.sessions).toHaveLength(1);
      });
    });

    it("navigates to /login when the current session itself is revoked", async () => {
      listSessionsMock.mockResolvedValue([ROW_A, ROW_B]);
      getSessionMock.mockResolvedValue(sessionWithToken("token-A"));
      revokeSessionMock.mockResolvedValue({ data: { status: true } });

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      if (result.current.state.kind !== "ready") return;

      await act(async () => {
        await result.current.revokeSession("token-A");
      });

      // The current-row revoke is intentionally a redirect: better-auth
      // logs you out but never redirects, and a blank page is the wrong
      // outcome here.
      expect(routerMock.push).toHaveBeenCalledWith("/login");
    });

    it("rethrows when revokeSession rejects so the caller can surface the error", async () => {
      listSessionsMock.mockResolvedValue([ROW_A, ROW_B]);
      getSessionMock.mockResolvedValue(sessionWithToken("token-A"));
      revokeSessionMock.mockRejectedValue(new Error("Forbidden"));

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      if (result.current.state.kind !== "ready") return;

      await act(async () => {
        await expect(result.current.revokeSession("token-B")).rejects.toThrow(
          "Forbidden",
        );
      });
    });
  });

  describe("revokeOtherSessions", () => {
    it("calls revokeOtherSessions and refetches", async () => {
      listSessionsMock
        .mockResolvedValueOnce([ROW_A, ROW_B])
        .mockResolvedValueOnce([ROW_A]);
      getSessionMock.mockResolvedValue(sessionWithToken("token-A"));
      revokeOtherSessionsMock.mockResolvedValue({ data: { status: true } });

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      if (result.current.state.kind !== "ready") return;

      await act(async () => {
        await result.current.revokeOtherSessions();
      });

      expect(revokeOtherSessionsMock).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        if (result.current.state.kind !== "ready") return;
        expect(result.current.state.sessions).toHaveLength(1);
      });
    });

    it("does not navigate — bulk revocation leaves the current session intact", async () => {
      listSessionsMock.mockResolvedValue([ROW_A, ROW_B]);
      getSessionMock.mockResolvedValue(sessionWithToken("token-A"));
      revokeOtherSessionsMock.mockResolvedValue({ data: { status: true } });

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      if (result.current.state.kind !== "ready") return;

      await act(async () => {
        await result.current.revokeOtherSessions();
      });

      expect(routerMock.push).not.toHaveBeenCalled();
    });
  });

  describe("revoking indicator", () => {
    it("reports the revoking token during a per-row revoke and clears it after", async () => {
      listSessionsMock.mockResolvedValue([ROW_A, ROW_B]);
      getSessionMock.mockResolvedValue(sessionWithToken("token-A"));
      let resolveRevoke!: () => void;
      revokeSessionMock.mockImplementation(
        () =>
          new Promise<{ data: { status: true } }>((res) => {
            resolveRevoke = () => res({ data: { status: true } });
          }),
      );

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));

      let inFlight!: Promise<void>;
      act(() => {
        inFlight = result.current.revokeSession("token-B");
      });
      expect(result.current.revoking).toBe("token-B");

      await act(async () => {
        resolveRevoke();
        await inFlight;
      });

      expect(result.current.revoking).toBeNull();
    });

    it("reports 'others' while a bulk revoke is in flight", async () => {
      listSessionsMock.mockResolvedValue([ROW_A, ROW_B]);
      getSessionMock.mockResolvedValue(sessionWithToken("token-A"));
      let resolveBulk!: () => void;
      revokeOtherSessionsMock.mockImplementation(
        () =>
          new Promise<{ data: { status: true } }>((res) => {
            resolveBulk = () => res({ data: { status: true } });
          }),
      );

      const { result } = renderHook(() => useActiveSessions());

      await waitFor(() => expect(result.current.state.kind).toBe("ready"));

      let inFlight!: Promise<void>;
      act(() => {
        inFlight = result.current.revokeOtherSessions();
      });
      expect(result.current.revoking).toBe("others");

      await act(async () => {
        resolveBulk();
        await inFlight;
      });

      expect(result.current.revoking).toBeNull();
    });
  });
});
