/**
 * @module web/tests/unit/hooks/useSignupForm
 * @description Signup form: the password-strength rules, the `callbackURL`
 * handed to better-auth, the verification dialog opened on success, the
 * watched email exposed as `submittedEmail`, and the failure branches.
 */
import { act, renderHook } from "@testing-library/react";
import type { ChangeEvent } from "react";
import type { UseFormRegister } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Shape of the signup form's values, as the schema infers them. */
type SignupValues = { name: string; email: string; password: string };

const { authClientMock } = vi.hoisted(() => ({
  authClientMock: {
    signUp: { email: vi.fn() },
  },
}));

vi.mock("../../../lib/auth-client", () => ({ authClient: authClientMock }));

import { useSignupForm } from "../../../hooks/useSignupForm";

const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

type AuthOptions = {
  onSuccess?: (ctx: { data: unknown }) => void;
  onError?: (ctx: { error: { status: number; message: string } }) => void;
};

const signUpEmail = authClientMock.signUp.email;

const succeedSignUp = () =>
  signUpEmail.mockImplementation(
    async (_credentials: unknown, options?: AuthOptions) => {
      options?.onSuccess?.({ data: { user: { id: "user-1" } } });
      return { data: { user: { id: "user-1" } }, error: null };
    },
  );

const failSignUp = (status: number, message: string) =>
  signUpEmail.mockImplementation(
    async (_credentials: unknown, options?: AuthOptions) => {
      options?.onError?.({ error: { status, message } });
      return { data: null, error: { status, message } };
    },
  );

const fillSignup = (
  result: { current: { register: UseFormRegister<SignupValues> } },
  overrides: Partial<SignupValues> = {},
) => {
  const values = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "password123!",
    ...overrides,
  };
  act(() => {
    result.current.register("name").onChange(change("name", values.name));
    result.current.register("email").onChange(change("email", values.email));
    result.current
      .register("password")
      .onChange(change("password", values.password));
  });
};

describe("useSignupForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts idle with the verification dialog closed", () => {
    const { result } = renderHook(() => useSignupForm());

    expect(result.current.showVerifyDialog).toBe(false);
    expect(result.current.firstError).toBeUndefined();
    expect(result.current.submittedEmail).toBe("");
  });

  it("mirrors the typed email as submittedEmail", () => {
    const { result } = renderHook(() => useSignupForm());
    fillSignup(result, { email: "grace@example.com" });

    expect(result.current.submittedEmail).toBe("grace@example.com");
  });

  it("allows the dialog to be closed again", () => {
    const { result } = renderHook(() => useSignupForm());

    act(() => {
      result.current.setShowVerifyDialog(true);
    });
    expect(result.current.showVerifyDialog).toBe(true);

    act(() => {
      result.current.setShowVerifyDialog(false);
    });
    expect(result.current.showVerifyDialog).toBe(false);
  });

  it("rejects a single-character name", async () => {
    const { result } = renderHook(() => useSignupForm());
    fillSignup(result, { name: "A" });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Full name must be at least 2 characters long.",
    );
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const { result } = renderHook(() => useSignupForm());
    fillSignup(result, { email: "ada@localhost" });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe("Enter a valid email.");
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects a password without a number", async () => {
    const { result } = renderHook(() => useSignupForm());
    fillSignup(result, { password: "password!" });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Password must contain at least one number.",
    );
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects a password without a special character", async () => {
    const { result } = renderHook(() => useSignupForm());
    fillSignup(result, { password: "password123" });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Password must contain at least one special character.",
    );
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("signs up and opens the verification dialog on success", async () => {
    succeedSignUp();
    const { result } = renderHook(() => useSignupForm());
    fillSignup(result);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(signUpEmail.mock.calls[0]?.[0]).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "password123!",
      callbackURL: "/email-verified",
    });
    expect(result.current.showVerifyDialog).toBe(true);
    expect(result.current.firstError).toBeUndefined();
  });

  it("keeps the dialog closed and reports the server message on failure", async () => {
    failSignUp(422, "An account with this email already exists");
    const { result } = renderHook(() => useSignupForm());
    fillSignup(result);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.showVerifyDialog).toBe(false);
    expect(result.current.firstError).toBe(
      "An account with this email already exists",
    );
  });

  it("falls back to a generic message when the auth client throws", async () => {
    signUpEmail.mockRejectedValue({});
    const { result } = renderHook(() => useSignupForm());
    fillSignup(result);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Something went wrong. Please try again.",
    );
    expect(result.current.showVerifyDialog).toBe(false);
  });

  it("reports isSubmitting while the signup call is pending", async () => {
    let release: (() => void) | undefined;
    signUpEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: {}, error: null });
        }),
    );

    const { result } = renderHook(() => useSignupForm());
    fillSignup(result);

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
