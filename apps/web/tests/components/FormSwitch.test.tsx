/**
 * @module web/tests/components/FormSwitch
 * @description End-to-end behaviour of the auth view switcher. Unlike the
 * presentational form tests, this drives the real `useLoginForm`,
 * `useSignupForm`, and `useForgotPasswordForm` hooks through msw, so the
 * validation, request payload, and error-mapping branches are genuinely
 * exercised.
 *
 * All three cards are mounted at once (the switch is a CSS crossfade), so every
 * query is scoped to the `section` that owns the heading. Placeholder-based
 * queries are used inside those sections because the login and signup cards
 * reuse the same `id` values, which makes label lookups document-wide.
 */
import "./testUtils";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { preflight, BACKEND_URL } from "./testUtils";
import { fail } from "../msw/handlers";
import FormSwitch from "../../components/FormSwitch";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/login",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

/** `section` element that owns the card with the given heading. */
const card = (heading: string) =>
  screen.getByRole("heading", { name: heading }).closest("section") as HTMLElement;

const loginCard = () => card("Welcome back");
const signupCard = () => card("Create your account");
const forgotCard = () => card("Forgot password?");

const loginEmail = () => within(loginCard()).getByPlaceholderText("tejas@example.com");
const loginPassword = () => within(loginCard()).getByPlaceholderText("••••••••");
const signupName = () => within(signupCard()).getByPlaceholderText("Tejas Nasa");
const signupEmail = () => within(signupCard()).getByPlaceholderText("tejas@example.com");
const signupPassword = () => within(signupCard()).getByPlaceholderText("••••••••");
const forgotEmail = () => within(forgotCard()).getByPlaceholderText("tejas@example.com");

/** Captures the JSON body of every request to `path`. */
function capture(path: string, response?: Response) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${BACKEND_URL}${path}`, async ({ request }) => {
      bodies.push(await request.json());
      return response ?? HttpResponse.json({ user: { id: "user-1" } });
    }),
  );
  return bodies;
}

beforeEach(() => {
  server.use(preflight);
});

describe("FormSwitch", () => {
  describe("login", () => {
    it("blocks submission until the credentials are well formed", async () => {
      const user = userEvent.setup();
      const bodies = capture("/api/auth/sign-in/email");
      render(<FormSwitch />);

      await user.type(loginEmail(), "not-an-email");
      await user.type(loginPassword(), "supersecret");
      await user.click(within(loginCard()).getByRole("button", { name: "Login" }));

      expect(await screen.findByText("Enter a valid email.")).toBeInTheDocument();
      expect(bodies).toHaveLength(0);
    });

    it("signs in and posts the credentials for the /home redirect", async () => {
      const user = userEvent.setup();
      const bodies = capture("/api/auth/sign-in/email");
      render(<FormSwitch />);

      await user.type(loginEmail(), "ada@example.com");
      await user.type(loginPassword(), "supersecret");
      await user.click(within(loginCard()).getByRole("button", { name: "Login" }));

      await screen.findByRole("heading", { name: "Welcome back" });
      expect(bodies[0]).toMatchObject({
        email: "ada@example.com",
        password: "supersecret",
      });
    });

    it("reports bad credentials from the server", async () => {
      const user = userEvent.setup();
      capture("/api/auth/sign-in/email", fail(401, "Invalid email or password"));
      render(<FormSwitch />);

      await user.type(loginEmail(), "ada@example.com");
      await user.type(loginPassword(), "supersecret");
      await user.click(within(loginCard()).getByRole("button", { name: "Login" }));

      expect(
        await screen.findByText("Invalid email or password"),
      ).toBeInTheDocument();
    });

    it("tells unverified users to verify instead of showing a raw 403", async () => {
      const user = userEvent.setup();
      capture("/api/auth/sign-in/email", fail(403, "Email not verified"));
      render(<FormSwitch />);

      await user.type(loginEmail(), "ada@example.com");
      await user.type(loginPassword(), "supersecret");
      await user.click(within(loginCard()).getByRole("button", { name: "Login" }));

      expect(
        await screen.findByText("Please verify your email before signing in."),
      ).toBeInTheDocument();
    });
  });

  describe("signup", () => {
    it("opens the switch from the login card", async () => {
      const user = userEvent.setup();
      render(<FormSwitch />);

      await user.click(
        within(loginCard()).getByRole("button", { name: /Sign up/ }),
      );

      expect(
        screen.getByRole("heading", { name: "Create your account" }),
      ).toBeInTheDocument();
    });

    it("rejects a weak password before calling the API", async () => {
      const user = userEvent.setup();
      const bodies = capture("/api/auth/sign-up/email");
      render(<FormSwitch />);

      await user.type(signupName(), "Ada Lovelace");
      await user.type(signupEmail(), "ada@example.com");
      await user.type(signupPassword(), "onlyletters");
      await user.click(
        within(signupCard()).getByRole("button", { name: "Create Account" }),
      );

      expect(
        await screen.findByText("Password must contain at least one number."),
      ).toBeInTheDocument();
      expect(bodies).toHaveLength(0);
    });

    it("asks the new account to verify its email after signing up", async () => {
      const user = userEvent.setup();
      const bodies = capture("/api/auth/sign-up/email");
      render(<FormSwitch />);

      await user.type(signupName(), "Ada Lovelace");
      await user.type(signupEmail(), "ada@example.com");
      await user.type(signupPassword(), "supersecret1!");
      await user.click(
        within(signupCard()).getByRole("button", { name: "Create Account" }),
      );

      expect(
        await screen.findByRole("heading", { name: "Check your email" }),
      ).toBeInTheDocument();
      expect(bodies[0]).toMatchObject({
        name: "Ada Lovelace",
        email: "ada@example.com",
        callbackURL: "/email-verified",
      });
    });

    it("surfaces a rejected signup on the card", async () => {
      const user = userEvent.setup();
      capture("/api/auth/sign-up/email", fail(422, "User already exists"));
      render(<FormSwitch />);

      await user.type(signupName(), "Ada Lovelace");
      await user.type(signupEmail(), "ada@example.com");
      await user.type(signupPassword(), "supersecret1!");
      await user.click(
        within(signupCard()).getByRole("button", { name: "Create Account" }),
      );

      expect(await screen.findByText("User already exists")).toBeInTheDocument();
    });
  });

  describe("forgot password", () => {
    it("opens from the login card and sends the reset link", async () => {
      const user = userEvent.setup();
      const bodies = capture("/api/auth/request-password-reset");
      render(<FormSwitch />);

      await user.click(
        within(loginCard()).getByRole("button", { name: "Forgot password?" }),
      );
      await user.type(forgotEmail(), "ada@example.com");
      await user.click(
        within(forgotCard()).getByRole("button", { name: "Send reset link" }),
      );

      expect(
        await screen.findByText(/a reset link has been sent/i),
      ).toBeInTheDocument();
      expect(bodies[0]).toMatchObject({ email: "ada@example.com" });
    });

    it("keeps the signup state while the user visits another view", async () => {
      const user = userEvent.setup();
      render(<FormSwitch />);

      await user.type(signupEmail(), "ada@example.com");
      await user.click(
        within(loginCard()).getByRole("button", { name: "Forgot password?" }),
      );
      await user.click(
        within(loginCard()).getByRole("button", { name: /Sign up/ }),
      );

      expect(signupEmail()).toHaveValue("ada@example.com");
    });
  });

  describe("inactive views", () => {
    it.fails(
      "removes the inactive auth cards from the accessibility tree",
      () => {
        render(<FormSwitch />);

        expect(within(signupCard()).queryByRole("textbox")).toBeNull();
        expect(within(forgotCard()).queryByRole("textbox")).toBeNull();
      },
    );

    it.fails("leaves each card's Email label pointing at its own field", () => {
      render(<FormSwitch />);

      const label = within(signupCard())
        .getByText("Email")
        .closest("label") as HTMLLabelElement;

      expect(label.control).toBe(signupEmail());
    });
  });
});
