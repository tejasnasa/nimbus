/**
 * @module web/tests/unit/hooks/useLoginForm
 * @description Sign-in form: Zod validation surfaced through `firstError`, the
 * `callbackURL: "/home"` payload, the dedicated message for unverified emails
 * (403), and the generic server/network failure branches.
 *
 * `authClient` is mocked rather than driven over the network: the hook's
 * contract is better-auth's callback interface (`onSuccess` / `onError` with a
 * `{ status, message }` error), and better-auth resolves instead of rejecting
 * on HTTP errors.
 */
import { act, renderHook } from "@testing-library/react";
import type { ChangeEvent } from "react";
import type { UseFormRegister } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Shape of the sign-in form's values, as the schema infers them. */
type LoginValues = { email: string; password: string };

const { authClientMock } = vi.hoisted(() => ({
  authClientMock: {
    signIn: { email: vi.fn() },
  },
}));

vi.mock("../../../lib/auth-client", () => ({ authClient: authClientMock }));

import { useLoginForm } from "../../../hooks/useLoginForm";

const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

type AuthOptions = {
  onSuccess?: (ctx: { data: unknown }) => void;
  onError?: (ctx: { error: { status: number; message: string } }) => void;
};

const signInEmail = authClientMock.signIn.email;

/** Emulates a failed better-auth call: `onError` runs and the call resolves. */
const failSignIn = (status: number, message: string) =>
  signInEmail.mockImplementation(
    async (_credentials: unknown, options?: AuthOptions) => {
      options?.onError?.({ error: { status, message } });
      return { data: null, error: { status, message } };
    },
  );

/** Emulates a successful better-auth call. */
const succeedSignIn = () =>
  signInEmail.mockImplementation(
    async (_credentials: unknown, options?: AuthOptions) => {
      options?.onSuccess?.({ data: { user: { id: "user-1" } } });
      return { data: { user: { id: "user-1" } }, error: null };
    },
  );

const fillCredentials = (
  result: { current: { register: UseFormRegister<LoginValues> } },
  email = "ada@example.com",
  password = "password123",
) => {
  act(() => {
    result.current.register("email").onChange(change("email", email));
    result.current.register("password").onChange(change("password", password));
  });
};

describe("useLoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with no error and not submitting", () => {
    const { result } = renderHook(() => useLoginForm());

    expect(result.current.firstError).toBeUndefined();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("rejects an invalid email without calling the auth client", async () => {
    const { result } = renderHook(() => useLoginForm());
    fillCredentials(result, "not-an-email");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe("Enter a valid email.");
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters", async () => {
    const { result } = renderHook(() => useLoginForm());
    fillCredentials(result, "ada@example.com", "short");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Password must be at least 8 characters long",
    );
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("signs in with the credentials and the /home callback", async () => {
    succeedSignIn();
    const { result } = renderHook(() => useLoginForm());
    fillCredentials(result, "ada@example.com", "password123");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(signInEmail).toHaveBeenCalledTimes(1);
    expect(signInEmail.mock.calls[0]?.[0]).toEqual({
      email: "ada@example.com",
      password: "password123",
      callbackURL: "/home",
    });
    expect(result.current.firstError).toBeUndefined();
  });

  it("asks the user to verify their email when the API answers 403", async () => {
    failSignIn(403, "Email not verified");
    const { result } = renderHook(() => useLoginForm());
    fillCredentials(result);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Please verify your email before signing in.",
    );
  });

  it("shows the server message for any other rejection", async () => {
    failSignIn(401, "Invalid email or password");
    const { result } = renderHook(() => useLoginForm());
    fillCredentials(result);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe("Invalid email or password");
  });

  it("falls back to a generic message when the auth client throws", async () => {
    signInEmail.mockRejectedValue({});
    const { result } = renderHook(() => useLoginForm());
    fillCredentials(result);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("propagates the thrown error's message when it has one", async () => {
    signInEmail.mockRejectedValue(new Error("Network unreachable"));
    const { result } = renderHook(() => useLoginForm());
    fillCredentials(result);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe("Network unreachable");
  });

  it("reports isSubmitting while the sign-in call is pending", async () => {
    let release: (() => void) | undefined;
    signInEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: {}, error: null });
        }),
    );

    const { result } = renderHook(() => useLoginForm());
    fillCredentials(result);

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
