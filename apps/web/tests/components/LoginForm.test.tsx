/**
 * @module web/tests/components/LoginForm
 * @description LoginForm is a presentational card: it must wire the email and
 * password fields to `register`, surface `firstError`, hand submission to the
 * injected handler, report the two view-switch callbacks, and launch the Google
 * OAuth flow through `authClient` with the `/home` callback.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { preflight, BACKEND_URL, FRONTEND_URL } from "./testUtils";
import LoginForm from "../../components/LoginForm";

type LoginValues = { email: string; password: string };

/**
 * Drives LoginForm through a real react-hook-form instance so typed input
 * reaches the component's `onSubmit` exactly as it does in `FormSwitch`.
 */
function Harness({
  firstError,
  onOpenSignup,
  onOpenForgotPassword,
  onSubmit = vi.fn(),
}: {
  firstError?: string;
  onOpenSignup?: () => void;
  onOpenForgotPassword?: () => void;
  onSubmit?: (values: LoginValues) => void;
}) {
  const form = useForm<LoginValues>({
    defaultValues: { email: "", password: "" },
  });

  return (
    <LoginForm
      register={form.register}
      firstError={firstError}
      isSubmitting={false}
      onSubmit={form.handleSubmit((values) => onSubmit(values))}
      openSignup={onOpenSignup}
      openForgotPassword={onOpenForgotPassword}
    />
  );
}

beforeEach(() => {
  server.use(preflight);
});

describe("LoginForm", () => {
  it("submits the credentials entered into the registered fields", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "supersecret");
    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "supersecret",
    });
  });

  it("shows the form error it is handed", () => {
    render(<Harness firstError="Invalid email or password" />);

    expect(screen.getByText("Invalid email or password")).toBeInTheDocument();
  });

  it("shows no error banner when there is nothing to report", () => {
    render(<Harness />);

    expect(screen.queryByText(/Invalid email or password/)).toBeNull();
  });

  it("asks the parent to switch to signup", async () => {
    const user = userEvent.setup();
    const onOpenSignup = vi.fn();
    render(<Harness onOpenSignup={onOpenSignup} />);

    await user.click(screen.getByRole("button", { name: /Sign up/ }));

    expect(onOpenSignup).toHaveBeenCalledTimes(1);
  });

  it("asks the parent to switch to the forgot-password view", async () => {
    const user = userEvent.setup();
    const onOpenForgotPassword = vi.fn();
    render(<Harness onOpenForgotPassword={onOpenForgotPassword} />);

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));

    expect(onOpenForgotPassword).toHaveBeenCalledTimes(1);
  });

  it("starts Google OAuth with the dashboard as the callback target", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${BACKEND_URL}/api/auth/sign-in/social`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ url: "https://accounts.google.com/o/oauth2" });
      }),
    );
    render(<Harness />);

    await user.click(
      screen.getByRole("button", { name: /Continue with Google/ }),
    );

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      provider: "google",
      callbackURL: `${FRONTEND_URL}/home`,
    });
  });
});
