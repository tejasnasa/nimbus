/**
 * @module web/tests/unit/hooks/useDeleteAccount
 * @description Behavioural coverage for the account-deletion manager:
 *
 * - The credential branch sends `password`; the Google-only branch omits
 *   it entirely (the wrong call would re-trigger the 24h freshness gate
 *   even for a fresh session).
 * - The `SESSION_EXPIRED` code is the recovery branch the dialog exists
 *   for: the hook signs the user out and pushes them to `/login` rather
 *   than showing a dead-end error.
 * - A successful delete navigates to `/login` and never sends
 *   `callbackURL` (`deleteUser` does not redirect on its own when
 *   `sendDeleteAccountVerification` is not configured).
 * - The typed-email confirmation is the irreversible-action gate: a
 *   near-match is rejected without calling `deleteUser`.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsMock, deleteUserMock, signOutMock, routerMock } =
  vi.hoisted(() => ({
    listAccountsMock: vi.fn(),
    deleteUserMock: vi.fn(),
    signOutMock: vi.fn(),
    routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
  }));

vi.mock("../../../lib/auth-client", () => ({
  authClient: {
    listAccounts: listAccountsMock,
    deleteUser: deleteUserMock,
    signOut: signOutMock,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import { useDeleteAccount } from "../../../hooks/useDeleteAccount";
import type { DeleteAccountState } from "../../../hooks/useDeleteAccount";

process.env.NEXT_PUBLIC_FRONTEND_URL = "http://localhost:3000";

const EMAIL = "ada@example.test";

/** Waits for the hook to leave the loading branch and exposes `state`
 *  through a getter so assertions see live values. Mirrors the
 *  `waitForKind` helper used by the change-password test. */
const waitForReady = async (result: {
  current: DeleteAccountState;
}): Promise<{ current: Extract<DeleteAccountState, { kind: "ready" }> }> => {
  const proxy: {
    current: Extract<DeleteAccountState, { kind: "ready" }>;
  } = {
    current: undefined as unknown as Extract<
      DeleteAccountState,
      { kind: "ready" }
    >,
  };
  Object.defineProperty(proxy, "current", {
    get: () => {
      const live = result.current;
      if (live.kind !== "ready") {
        throw new Error(`expected kind "ready", got "${live.kind}"`);
      }
      return live;
    },
  });
  await waitFor(() => {
    expect(result.current.kind).toBe("ready");
  });
  return proxy;
};

/** Matches the `change` shape that `register("name").onChange` expects
 *  from RHF. */
const change = (name: string, value: string) =>
  ({
    target: { name, value },
  }) as unknown as React.ChangeEvent<HTMLInputElement>;

describe("useDeleteAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerMock.push.mockClear();
    signOutMock.mockResolvedValue({ data: { success: true }, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("credential user", () => {
    beforeEach(() => {
      listAccountsMock.mockResolvedValue([
        { providerId: "credential", id: "acct-1" },
      ]);
    });

    it("resolves into the ready branch with needsPassword=true", async () => {
      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      const ready = await waitForReady(result);
      expect(ready.current.needsPassword).toBe(true);
      expect(ready.current.expectedEmail).toBe(EMAIL);
    });

    it("forwards the password to deleteUser when the typed email matches", async () => {
      deleteUserMock.mockImplementation(
        async (
          _payload: unknown,
          opts?: { onSuccess?: (ctx: { data: unknown }) => void },
        ) => {
          opts?.onSuccess?.({ data: { success: true } });
          return { data: { success: true }, error: null };
        },
      );

      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      const ready = await waitForReady(result);

      act(() => {
        ready.current
          .register("confirmEmail")
          .onChange(change("confirmEmail", EMAIL));
        ready.current
          .register("password")
          .onChange(change("password", "correct horse battery staple"));
      });

      await act(async () => {
        await ready.current.onSubmit();
      });

      expect(deleteUserMock).toHaveBeenCalledTimes(1);
      expect(deleteUserMock).toHaveBeenCalledWith(
        { password: "correct horse battery staple" },
        expect.objectContaining({ onError: expect.any(Function) }),
      );
      expect(routerMock.push).toHaveBeenCalledWith("/login");
      expect(signOutMock).toHaveBeenCalled();
    });

    it("never sends callbackURL on the wire payload", async () => {
      deleteUserMock.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      const ready = await waitForReady(result);

      act(() => {
        ready.current
          .register("confirmEmail")
          .onChange(change("confirmEmail", EMAIL));
        ready.current
          .register("password")
          .onChange(change("password", "irrelevant"));
      });

      await act(async () => {
        await ready.current.onSubmit();
      });

      const payload = deleteUserMock.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(payload).not.toHaveProperty("callbackURL");
      expect(payload).not.toHaveProperty("callbackUrl");
    });

    it("rejects a near-match typed email without calling deleteUser", async () => {
      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      const ready = await waitForReady(result);

      act(() => {
        // One character changed in the domain part so the email is
        // structurally valid but no longer matches the seeded address.
        ready.current
          .register("confirmEmail")
          .onChange(change("confirmEmail", "ada@example.tes"));
      });

      await act(async () => {
        await ready.current.onSubmit();
      });

      expect(deleteUserMock).not.toHaveBeenCalled();
      expect(ready.current.firstError).toBe(
        "Email does not match your account email.",
      );
    });

    it("accepts the typed email case-insensitively", async () => {
      deleteUserMock.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      const ready = await waitForReady(result);

      act(() => {
        ready.current
          .register("confirmEmail")
          .onChange(change("confirmEmail", EMAIL.toUpperCase()));
        ready.current
          .register("password")
          .onChange(change("password", "irrelevant"));
      });

      await act(async () => {
        await ready.current.onSubmit();
      });

      expect(deleteUserMock).toHaveBeenCalledTimes(1);
    });

    it("surfaces a server error message on a non-session-expired failure", async () => {
      deleteUserMock.mockImplementation(
        async (
          _payload: unknown,
          opts?: {
            onError?: (ctx: {
              error: { message: string; code: string };
            }) => void;
          },
        ) => {
          opts?.onError?.({
            error: { message: "Database unavailable", code: "INTERNAL" },
          });
          return {
            data: null,
            error: { message: "Database unavailable", code: "INTERNAL" },
          };
        },
      );

      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      const ready = await waitForReady(result);

      act(() => {
        ready.current
          .register("confirmEmail")
          .onChange(change("confirmEmail", EMAIL));
        ready.current.register("password").onChange(change("password", "any"));
      });

      await act(async () => {
        await ready.current.onSubmit();
      });

      await waitFor(() =>
        expect(ready.current.submitError).toBe("Database unavailable"),
      );
      expect(routerMock.push).not.toHaveBeenCalled();
      expect(signOutMock).not.toHaveBeenCalled();
    });

    it("falls back to a generic message when deleteUser throws", async () => {
      deleteUserMock.mockRejectedValue({});

      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      const ready = await waitForReady(result);

      act(() => {
        ready.current
          .register("confirmEmail")
          .onChange(change("confirmEmail", EMAIL));
        ready.current.register("password").onChange(change("password", "any"));
      });

      await act(async () => {
        await ready.current.onSubmit();
      });

      await waitFor(() =>
        expect(ready.current.submitError).toBe(
          "Could not delete your account. Please try again.",
        ),
      );
    });
  });

  describe("Google-only user", () => {
    beforeEach(() => {
      listAccountsMock.mockResolvedValue([{ providerId: "google", id: "g-1" }]);
    });

    it("resolves into the ready branch with needsPassword=false", async () => {
      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      const ready = await waitForReady(result);
      expect(ready.current.needsPassword).toBe(false);
    });

    it("calls deleteUser with an empty payload (no password) on a fresh session", async () => {
      deleteUserMock.mockImplementation(
        async (
          _payload: unknown,
          opts?: { onSuccess?: (ctx: { data: unknown }) => void },
        ) => {
          opts?.onSuccess?.({ data: { success: true } });
          return { data: { success: true }, error: null };
        },
      );

      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      const ready = await waitForReady(result);

      act(() => {
        ready.current
          .register("confirmEmail")
          .onChange(change("confirmEmail", EMAIL));
      });

      await act(async () => {
        await ready.current.onSubmit();
      });

      expect(deleteUserMock).toHaveBeenCalledTimes(1);
      const payload = deleteUserMock.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(payload).not.toHaveProperty("password");
      expect(routerMock.push).toHaveBeenCalledWith("/login");
    });

    it("signs the user out and redirects to /login on a SESSION_EXPIRED error", async () => {
      deleteUserMock.mockImplementation(
        async (
          _payload: unknown,
          opts?: {
            onError?: (ctx: {
              error: { code: string; message: string };
            }) => void;
          },
        ) => {
          opts?.onError?.({
            error: { code: "SESSION_EXPIRED", message: "Session expired" },
          });
          return {
            data: null,
            error: { code: "SESSION_EXPIRED", message: "Session expired" },
          };
        },
      );

      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      const ready = await waitForReady(result);

      act(() => {
        ready.current
          .register("confirmEmail")
          .onChange(change("confirmEmail", EMAIL));
      });

      await act(async () => {
        await ready.current.onSubmit();
      });

      expect(signOutMock).toHaveBeenCalled();
      expect(routerMock.push).toHaveBeenCalledWith("/login");
      // The submit error must NOT surface "Session expired" verbatim — the
      // whole point of the branch is to recover, not to display a dead-end
      // message. The success path's `deleted` banner handles the
      // user-visible feedback.
      expect(ready.current.submitError).toBeNull();
    });
  });

  describe("loading state", () => {
    it("stays in the loading branch while listAccounts is in flight", async () => {
      listAccountsMock.mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      // Wait a tick so the effect runs without resolving.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(result.current.kind).toBe("loading");
    });

    it("surfaces the load error and stays in the loading branch on rejection", async () => {
      listAccountsMock.mockRejectedValue({
        error: { message: "Network down" },
      });
      const { result } = renderHook(() => useDeleteAccount(EMAIL));
      await waitFor(() =>
        expect(
          result.current.kind === "loading" && result.current.loadError,
        ).toBe("Network down"),
      );
    });
  });
});
