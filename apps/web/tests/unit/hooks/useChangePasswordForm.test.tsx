/**
 * @module web/tests/unit/hooks/useChangePasswordForm
 * @description Both branches of the change-password manager, driven by a
 * mocked `listAccounts`:
 *
 * - **Credential user** → the change-password form with the
 *   `revokeOtherSessions` checkbox; submit calls `changePassword` with the
 *   full payload, including `revokeOtherSessions`.
 * - **Google-only user** → a "Send me a set-password link" affordance that
 *   calls `requestPasswordReset`. The negative assertion (no
 *   `changePassword` call) is the load-bearing one — the whole reason the
 *   branch exists is to prevent a `CREDENTIAL_ACCOUNT_NOT_FOUND` 400 from
 *   `changePassword`.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsMock, changePasswordMock, requestPasswordResetMock } =
  vi.hoisted(() => ({
    listAccountsMock: vi.fn(),
    changePasswordMock: vi.fn(),
    requestPasswordResetMock: vi.fn(),
  }));

vi.mock("../../../lib/auth-client", () => ({
  authClient: {
    listAccounts: listAccountsMock,
    changePassword: changePasswordMock,
    requestPasswordReset: requestPasswordResetMock,
  },
}));

import { useChangePasswordForm } from "../../../hooks/useChangePasswordForm";
import type { ChangePasswordState } from "../../../hooks/useChangePasswordForm";

process.env.NEXT_PUBLIC_FRONTEND_URL = "http://localhost:3000";

const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

/** Mimics better-auth's success resolution shape. */
const success = <T,>(data: T) => ({ data, error: null });
/** Mimics better-auth's error resolution shape (response with non-2xx). */
const failWith = (message: string, code = "INVALID") => ({
  data: null,
  error: { message, code },
});

/**
 * Reads `result.current` afresh each iteration of `waitFor` and yields
 * the latest snapshot once `kind` matches. The returned object is
 * live: subsequent property reads go through this getter again rather
 * than snapshotting, so assertions like `state.error` after a network
 * round-trip see the updated value.
 */
const waitForKind = async <K extends ChangePasswordState["kind"]>(
  result: { current: ChangePasswordState },
  kind: K,
): Promise<{
  current: Extract<ChangePasswordState, { kind: K }>;
}> => {
  // Use `Object.defineProperty` with a getter so `proxy.current.foo` is
  // always a fresh read off `result.current`.
  const proxy: { current: Extract<ChangePasswordState, { kind: K }> } = {
    current: undefined as unknown as Extract<ChangePasswordState, { kind: K }>,
  };
  Object.defineProperty(proxy, "current", {
    get: () => {
      const live = result.current;
      if (live.kind !== kind) {
        throw new Error(`expected kind "${kind}", got "${live.kind}"`);
      }
      return live as Extract<ChangePasswordState, { kind: K }>;
    },
  });

  await waitFor(() => {
    // Force the getter; the side effect is the throw, but we also need
    // the assertion for the waitFor loop.
    expect(result.current.kind).toBe(kind);
  });

  return proxy;
};

describe("useChangePasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("credential user", () => {
    beforeEach(() => {
      listAccountsMock.mockResolvedValue([
        { providerId: "credential", id: "acct-1" },
        { providerId: "google", id: "acct-2" },
      ]);
    });

    it("starts in the with-password branch once listAccounts resolves", async () => {
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      await waitForKind(result, "with-password");
    });

    it("forwards the full payload — including revokeOtherSessions — to changePassword", async () => {
      changePasswordMock.mockImplementation(
        async (
          _payload: unknown,
          opts?: {
            onSuccess?: (ctx: { data: unknown }) => void;
            onError?: (ctx: { error: { message: string } }) => void;
          },
        ) => {
          opts?.onSuccess?.({ data: { status: true } });
          return success({ status: true });
        },
      );

      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      const state = await waitForKind(result, "with-password");

      act(() => {
        state.current
          .register("currentPassword")
          .onChange(change("currentPassword", "OldP@ssword-1"));
        state.current
          .register("newPassword")
          .onChange(change("newPassword", "NewP@ssword-456"));
        state.current
          .register("confirmPassword")
          .onChange(change("confirmPassword", "NewP@ssword-456"));
      });

      await act(async () => {
        await state.current.onSubmit();
      });

      expect(changePasswordMock).toHaveBeenCalledTimes(1);
      expect(changePasswordMock).toHaveBeenCalledWith(
        {
          currentPassword: "OldP@ssword-1",
          newPassword: "NewP@ssword-456",
          revokeOtherSessions: true,
        },
        expect.objectContaining({ onError: expect.any(Function) }),
      );
      expect(requestPasswordResetMock).not.toHaveBeenCalled();
    });

    it("rejects a password shorter than 8 characters without calling changePassword", async () => {
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      const state = await waitForKind(result, "with-password");

      act(() => {
        state.current
          .register("currentPassword")
          .onChange(change("currentPassword", "OldP@ssword-1"));
        state.current
          .register("newPassword")
          .onChange(change("newPassword", "short"));
        state.current
          .register("confirmPassword")
          .onChange(change("confirmPassword", "short"));
      });

      await act(async () => {
        await state.current.onSubmit();
      });

      expect(changePasswordMock).not.toHaveBeenCalled();
      expect(state.current.firstError).toBe(
        "Password must be at least 8 characters.",
      );
    });

    it("rejects mismatched confirmation without calling changePassword", async () => {
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      const state = await waitForKind(result, "with-password");

      act(() => {
        state.current
          .register("currentPassword")
          .onChange(change("currentPassword", "OldP@ssword-1"));
        state.current
          .register("newPassword")
          .onChange(change("newPassword", "NewP@ssword-456"));
        state.current
          .register("confirmPassword")
          .onChange(change("confirmPassword", "NewP@ssword-789"));
      });

      await act(async () => {
        await state.current.onSubmit();
      });

      expect(changePasswordMock).not.toHaveBeenCalled();
      expect(state.current.firstError).toBe("Passwords do not match");
    });

    it("surfaces a server error message and does not clear the form on failure", async () => {
      changePasswordMock.mockImplementation(
        async (
          _payload: unknown,
          opts?: {
            onError?: (ctx: { error: { message: string } }) => void;
          },
        ) => {
          opts?.onError?.({ error: { message: "Incorrect current password" } });
          return failWith("Incorrect current password");
        },
      );
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      const state = await waitForKind(result, "with-password");

      act(() => {
        state.current
          .register("currentPassword")
          .onChange(change("currentPassword", "OldP@ssword-1"));
        state.current
          .register("newPassword")
          .onChange(change("newPassword", "NewP@ssword-456"));
        state.current
          .register("confirmPassword")
          .onChange(change("confirmPassword", "NewP@ssword-456"));
      });

      await act(async () => {
        await state.current.onSubmit();
      });

      await waitFor(() =>
        expect(state.current.firstError).toBe("Incorrect current password"),
      );
    });

    it("falls back to a generic message when the auth client throws", async () => {
      // Some failure modes bypass `onError` (network down before the
      // request, for instance) and reject the promise itself. The hook
      // must catch and surface a usable message rather than crash.
      changePasswordMock.mockRejectedValue({});
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      const state = await waitForKind(result, "with-password");

      act(() => {
        state.current
          .register("currentPassword")
          .onChange(change("currentPassword", "OldP@ssword-1"));
        state.current
          .register("newPassword")
          .onChange(change("newPassword", "NewP@ssword-456"));
        state.current
          .register("confirmPassword")
          .onChange(change("confirmPassword", "NewP@ssword-456"));
      });

      await act(async () => {
        await state.current.onSubmit();
      });

      await waitFor(() =>
        expect(state.current.firstError).toBe(
          "Could not change your password. Please try again.",
        ),
      );
    });
  });

  describe("Google-only user", () => {
    beforeEach(() => {
      listAccountsMock.mockResolvedValue([{ providerId: "google", id: "g-1" }]);
    });

    it("renders the google-only branch", async () => {
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      await waitForKind(result, "google-only");
    });

    it("calls requestPasswordReset with the user's email and the frontend reset route", async () => {
      requestPasswordResetMock.mockImplementation(
        async (
          _payload: unknown,
          opts?: { onSuccess?: (ctx: { data: unknown }) => void },
        ) => {
          opts?.onSuccess?.({ data: { status: true } });
          return success({ status: true });
        },
      );
      const { result } = renderHook(() =>
        useChangePasswordForm("ada@example.test"),
      );
      const state = await waitForKind(result, "google-only");

      await act(async () => {
        await state.current.onSubmit();
      });

      expect(requestPasswordResetMock).toHaveBeenCalledTimes(1);
      expect(requestPasswordResetMock).toHaveBeenCalledWith(
        {
          email: "ada@example.test",
          redirectTo: "http://localhost:3000/reset-password",
        },
        expect.objectContaining({ onError: expect.any(Function) }),
      );
    });

    it("never calls changePassword in this branch", async () => {
      requestPasswordResetMock.mockResolvedValue(success({ status: true }));
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      const state = await waitForKind(result, "google-only");

      await act(async () => {
        await state.current.onSubmit();
      });

      // The linchpin assertion: a Google-only user must not see a
      // changePassword call. better-auth would respond with
      // CREDENTIAL_ACCOUNT_NOT_FOUND, which is the failure mode the
      // branching exists to prevent.
      expect(changePasswordMock).not.toHaveBeenCalled();
    });

    it("flips sent to true after a successful reset request", async () => {
      requestPasswordResetMock.mockImplementation(
        async (
          _payload: unknown,
          opts?: { onSuccess?: (ctx: { data: unknown }) => void },
        ) => {
          opts?.onSuccess?.({ data: { status: true } });
          return success({ status: true });
        },
      );
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      const state = await waitForKind(result, "google-only");

      expect(state.current.sent).toBe(false);

      await act(async () => {
        await state.current.onSubmit();
      });

      expect(state.current.sent).toBe(true);
      expect(state.current.error).toBeNull();
    });

    it("surfaces the server error message and does not flip sent on failure", async () => {
      requestPasswordResetMock.mockImplementation(
        async (
          _payload: unknown,
          opts?: { onError?: (ctx: { error: { message: string } }) => void },
        ) => {
          opts?.onError?.({ error: { message: "Rate limit exceeded" } });
          return failWith("Rate limit exceeded");
        },
      );
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      const state = await waitForKind(result, "google-only");

      await act(async () => {
        await state.current.onSubmit();
      });

      expect(state.current.sent).toBe(false);
      expect(state.current.error).toBe("Rate limit exceeded");
    });

    it("falls back to a generic message when the auth client throws", async () => {
      // Some failure modes bypass `onError` and reject the promise itself.
      requestPasswordResetMock.mockRejectedValue({});
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      const state = await waitForKind(result, "google-only");

      await act(async () => {
        await state.current.onSubmit();
      });

      expect(state.current.error).toBe(
        "Could not send the set-password link. Please try again.",
      );
      expect(state.current.sent).toBe(false);
    });
  });

  describe("loading state", () => {
    it("starts in the loading branch before listAccounts resolves", async () => {
      // Never-resolving listAccounts to keep the hook in the loading
      // branch.
      listAccountsMock.mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      await waitForKind(result, "loading");
    });

    it("reports a load error and stays in the loading branch on rejection", async () => {
      listAccountsMock.mockRejectedValue({
        error: { message: "Network down" },
      });
      const { result } = renderHook(() => useChangePasswordForm("a@b.test"));
      const state = await waitForKind(result, "loading");
      await waitFor(() => expect(state.current.loadError).toBe("Network down"));
      // `kind` stays `loading` on a probe failure — without a definitive
      // has-password answer, defaulting to the credential branch would
      // be the wrong call (the very bug the branch exists to prevent).
      expect(result.current.kind).toBe("loading");
    });
  });
});
