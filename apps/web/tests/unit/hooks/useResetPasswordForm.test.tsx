/**
 * @module web/tests/unit/hooks/useResetPasswordForm
 * @description Reset completion: password confirmation via a Zod refinement,
 * the token handed to better-auth, the `done` flag, and the delayed redirect to
 * `/login` that follows a successful reset.
 */
import { act, renderHook } from "@testing-library/react";
import type { ChangeEvent } from "react";
import type { UseFormRegister } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Shape of the reset form's values, as the schema infers them. */
type ResetValues = { password: string; confirmPassword: string };

const { authClientMock, routerMock } = vi.hoisted(() => ({
  authClientMock: { resetPassword: vi.fn() },
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("../../../lib/auth-client", () => ({ authClient: authClientMock }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

import { useResetPasswordForm } from "../../../hooks/useResetPasswordForm";

const REDIRECT_DELAY_MS = 2500;

const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

type AuthOptions = {
  onSuccess?: (ctx: { data: unknown }) => void;
  onError?: (ctx: { error: { message: string } }) => void;
};

const resetPassword = authClientMock.resetPassword;

const succeedReset = () =>
  resetPassword.mockImplementation(
    async (_payload: unknown, options?: AuthOptions) => {
      options?.onSuccess?.({ data: { status: true } });
      return { data: { status: true }, error: null };
    },
  );

const fillPasswords = (
  result: { current: { register: UseFormRegister<ResetValues> } },
  password = "password123",
  confirmPassword = password,
) => {
  act(() => {
    result.current.register("password").onChange(change("password", password));
    result.current
      .register("confirmPassword")
      .onChange(change("confirmPassword", confirmPassword));
  });
};

describe("useResetPasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts undone with no error", () => {
    const { result } = renderHook(() => useResetPasswordForm("reset-token"));

    expect(result.current.done).toBe(false);
    expect(result.current.firstError).toBeUndefined();
  });

  it("rejects a password shorter than 8 characters", async () => {
    const { result } = renderHook(() => useResetPasswordForm("reset-token"));
    fillPasswords(result, "short", "short");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Password must be at least 8 characters",
    );
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmation", async () => {
    const { result } = renderHook(() => useResetPasswordForm("reset-token"));
    fillPasswords(result, "password123", "password124");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe("Passwords do not match");
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("submits the new password with the emailed token", async () => {
    succeedReset();
    const { result } = renderHook(() => useResetPasswordForm("reset-token"));
    fillPasswords(result, "password123");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(resetPassword.mock.calls[0]?.[0]).toEqual({
      newPassword: "password123",
      token: "reset-token",
    });
    expect(result.current.done).toBe(true);
  });

  it("routes to /login once the confirmation has had time to be read", async () => {
    vi.useFakeTimers();
    succeedReset();
    const { result } = renderHook(() => useResetPasswordForm("reset-token"));
    fillPasswords(result, "password123");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(routerMock.push).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(REDIRECT_DELAY_MS);
    });

    expect(routerMock.push).toHaveBeenCalledWith("/login");
  });

  it("reports the server message and stays undone when the token is rejected", async () => {
    resetPassword.mockImplementation(
      async (_payload: unknown, options?: AuthOptions) => {
        options?.onError?.({
          error: { message: "Invalid or expired token" },
        });
        return { data: null, error: { message: "Invalid or expired token" } };
      },
    );
    const { result } = renderHook(() => useResetPasswordForm("stale-token"));
    fillPasswords(result, "password123");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe("Invalid or expired token");
    expect(result.current.done).toBe(false);
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the auth client throws", async () => {
    resetPassword.mockRejectedValue({});
    const { result } = renderHook(() => useResetPasswordForm("reset-token"));
    fillPasswords(result, "password123");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Something went wrong. Please try again.",
    );
    expect(result.current.done).toBe(false);
  });

  it("reports isSubmitting while the reset call is pending", async () => {
    let release: (() => void) | undefined;
    resetPassword.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: {}, error: null });
        }),
    );

    const { result } = renderHook(() => useResetPasswordForm("reset-token"));
    fillPasswords(result, "password123");

    let submit: Promise<void>;
    await act(async () => {
      submit = result.current.onSubmit();
    });

    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      release?.();
      await submit;
    });

    expect(result.current.isSubmitting).toBe(false);
  });

  it.fails(
    "does not navigate to /login after the reset form has unmounted",
    async () => {
      // The redirect timer is never cleared, so a user who leaves the page
      // within the 2.5s window is still yanked to /login.
      vi.useFakeTimers();
      succeedReset();
      const { result, unmount } = renderHook(() =>
        useResetPasswordForm("reset-token"),
      );
      fillPasswords(result, "password123");

      await act(async () => {
        await result.current.onSubmit();
      });

      unmount();

      await act(async () => {
        vi.advanceTimersByTime(REDIRECT_DELAY_MS);
      });

      expect(routerMock.push).not.toHaveBeenCalled();
    },
  );
});
