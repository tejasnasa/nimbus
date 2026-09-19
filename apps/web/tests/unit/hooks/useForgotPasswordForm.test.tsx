/**
 * @module web/tests/unit/hooks/useForgotPasswordForm
 * @description Reset-request form: email validation, the `redirectTo` pointed
 * at the client's own `/reset-password` route, the `sent` confirmation flag,
 * and the failure branches.
 */
import { act, renderHook } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authClientMock } = vi.hoisted(() => ({
  authClientMock: { requestPasswordReset: vi.fn() },
}));

vi.mock("../../../lib/auth-client", () => ({ authClient: authClientMock }));

import { useForgotPasswordForm } from "../../../hooks/useForgotPasswordForm";

process.env.NEXT_PUBLIC_FRONTEND_URL = "http://localhost:3000";

const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

type AuthOptions = {
  onSuccess?: (ctx: { data: unknown }) => void;
  onError?: (ctx: { error: { status: number; message: string } }) => void;
};

const requestReset = authClientMock.requestPasswordReset;

const succeedReset = () =>
  requestReset.mockImplementation(
    async (_payload: unknown, options?: AuthOptions) => {
      options?.onSuccess?.({ data: { status: true } });
      return { data: { status: true }, error: null };
    },
  );

const failReset = (status: number, message: string) =>
  requestReset.mockImplementation(
    async (_payload: unknown, options?: AuthOptions) => {
      options?.onError?.({ error: { status, message } });
      return { data: null, error: { status, message } };
    },
  );

describe("useForgotPasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts unsent with no error", () => {
    const { result } = renderHook(() => useForgotPasswordForm());

    expect(result.current.sent).toBe(false);
    expect(result.current.firstError).toBeUndefined();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("rejects an invalid email without asking the API for a link", async () => {
    const { result } = renderHook(() => useForgotPasswordForm());
    act(() => {
      result.current.register("email").onChange(change("email", "nope"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe("Enter a valid email address");
    expect(requestReset).not.toHaveBeenCalled();
    expect(result.current.sent).toBe(false);
  });

  it("requests a reset link that redirects to the client's reset route", async () => {
    succeedReset();
    const { result } = renderHook(() => useForgotPasswordForm());
    act(() => {
      result.current
        .register("email")
        .onChange(change("email", "ada@example.com"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(requestReset.mock.calls[0]?.[0]).toEqual({
      email: "ada@example.com",
      redirectTo: "http://localhost:3000/reset-password",
    });
    expect(result.current.sent).toBe(true);
    expect(result.current.firstError).toBeUndefined();
  });

  it("stays unsent and reports the server message when the request fails", async () => {
    failReset(429, "Too many requests. Try again later.");
    const { result } = renderHook(() => useForgotPasswordForm());
    act(() => {
      result.current
        .register("email")
        .onChange(change("email", "ada@example.com"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.sent).toBe(false);
    expect(result.current.firstError).toBe(
      "Too many requests. Try again later.",
    );
  });

  it("falls back to a generic message when the auth client throws", async () => {
    requestReset.mockRejectedValue({});
    const { result } = renderHook(() => useForgotPasswordForm());
    act(() => {
      result.current
        .register("email")
        .onChange(change("email", "ada@example.com"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Something went wrong. Please try again.",
    );
    expect(result.current.sent).toBe(false);
  });

  it("reports isSubmitting while the reset request is pending", async () => {
    let release: (() => void) | undefined;
    requestReset.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: {}, error: null });
        }),
    );

    const { result } = renderHook(() => useForgotPasswordForm());
    act(() => {
      result.current
        .register("email")
        .onChange(change("email", "ada@example.com"));
    });

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
});
