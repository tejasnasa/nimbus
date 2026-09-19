/**
 * @module web/tests/components/SignupForm
 * @description SignupForm is a presentational card: it wires name/email/password
 * through `register`, surfaces `firstError`, reports the login switch, launches
 * Google OAuth, and hosts the "check your email" dialog for whichever address was
 * submitted.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { preflight, BACKEND_URL, FRONTEND_URL } from "./testUtils";
import SignupForm from "../../components/SignupForm";

type SignupValues = { name: string; email: string; password: string };

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/signup",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Drives SignupForm with a real react-hook-form instance and local dialog state,
 * mirroring the wiring `useSignupForm` provides in the app.
 */
function Harness({
  firstError,
  openLogin,
  onSubmit = vi.fn(),
  startWithDialogOpen = false,
}: {
  firstError?: string;
  openLogin?: () => void;
  onSubmit?: (values: SignupValues) => void;
  startWithDialogOpen?: boolean;
}) {
  const form = useForm<SignupValues>({
    defaultValues: { name: "", email: "", password: "" },
  });
  const [showVerifyDialog, setShowVerifyDialog] = useState(
    startWithDialogOpen,
  );
  const submittedEmail = form.watch("email");

  return (
    <SignupForm
      register={form.register}
      firstError={firstError}
      isSubmitting={false}
      onSubmit={form.handleSubmit((values) => onSubmit(values))}
      openLogin={openLogin}
      showVerifyDialog={showVerifyDialog}
      setShowVerifyDialog={setShowVerifyDialog}
      submittedEmail={submittedEmail}
    />
  );
}

beforeEach(() => {
  push.mockClear();
  server.use(preflight);
});

describe("SignupForm", () => {
  it("submits the details entered into the registered fields", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "supersecret1!");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "supersecret1!",
    });
  });

  it("shows the form error it is handed", () => {
    render(<Harness firstError="User already exists" />);

    expect(screen.getByText("User already exists")).toBeInTheDocument();
  });

  it("asks the parent to switch to login", async () => {
    const user = userEvent.setup();
    const openLogin = vi.fn();
    render(<Harness openLogin={openLogin} />);

    await user.click(screen.getByRole("button", { name: /Sign in/ }));

    expect(openLogin).toHaveBeenCalledTimes(1);
  });

  it("shows the verification dialog for the submitted address", async () => {
    const user = userEvent.setup();
    render(<Harness startWithDialogOpen />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");

    expect(
      screen.getByRole("heading", { name: "Check your email" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("closes the dialog and sends the user to login once verified", async () => {
    const user = userEvent.setup();
    render(<Harness startWithDialogOpen />);

    await user.click(
      screen.getByRole("button", { name: /I've Verified/ }),
    );

    expect(
      screen.queryByRole("heading", { name: "Check your email" }),
    ).not.toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("hides the verification dialog while signup is still in progress", () => {
    render(<Harness />);

    expect(
      screen.queryByRole("heading", { name: "Check your email" }),
    ).not.toBeInTheDocument();
  });

  it("starts Google OAuth with the dashboard as the callback target", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post(
        `${BACKEND_URL}/api/auth/sign-in/social`,
        async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json({ url: "https://accounts.google.com/o/oauth2" });
        },
      ),
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
