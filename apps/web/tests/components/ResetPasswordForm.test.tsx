/**
 * @module web/tests/components/ResetPasswordForm
 * @description New-password card. It owns `useResetPasswordForm(token)`, so
 * these tests cover the confirm-password refinement, the token being posted with
 * the new password, the confirmation state, the delayed redirect back to login,
 * and the expired-link failure path.
 */
import "./testUtils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { preflight, BACKEND_URL } from "./testUtils";
import { fail } from "../msw/handlers";
import ResetPasswordForm from "../../components/ResetPasswordForm";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/reset-password",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams({ token: "reset-token" }),
}));

/**
 * Captures the reset-password request body and answers with `response`.
 */
function resetEndpoint(body: unknown[] = [], response?: Response) {
  return http.post(
    `${BACKEND_URL}/api/auth/reset-password`,
    async ({ request }) => {
      body.push(await request.json());
      return response ?? HttpResponse.json({ status: true });
    },
  );
}

beforeEach(() => {
  push.mockClear();
  server.use(preflight, resetEndpoint());
});

describe("ResetPasswordForm", () => {
  it("rejects mismatched passwords before hitting the API", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(resetEndpoint(bodies));
    render(<ResetPasswordForm token="reset-token" />);

    await user.type(screen.getByLabelText("New Password"), "supersecret1!");
    await user.type(screen.getByLabelText("Confirm Password"), "different1!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it("rejects a password that is too short", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="reset-token" />);

    await user.type(screen.getByLabelText("New Password"), "short");
    await user.type(screen.getByLabelText("Confirm Password"), "short");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(
      screen.getByText("Password must be at least 8 characters"),
    ).toBeInTheDocument();
  });

  it("submits the new password together with the emailed token", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(resetEndpoint(bodies));
    render(<ResetPasswordForm token="reset-token" />);

    await user.type(screen.getByLabelText("New Password"), "supersecret1!");
    await user.type(screen.getByLabelText("Confirm Password"), "supersecret1!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(
      await screen.findByText(/Password updated! Redirecting you to login/i),
    ).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({
      newPassword: "supersecret1!",
      token: "reset-token",
    });
  });

  it("sends the user back to login shortly after a successful reset", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="reset-token" />);

    await user.type(screen.getByLabelText("New Password"), "supersecret1!");
    await user.type(screen.getByLabelText("Confirm Password"), "supersecret1!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"), {
      timeout: 4000,
    });
  });

  it("reports an expired link instead of pretending the reset worked", async () => {
    const user = userEvent.setup();
    server.use(resetEndpoint([], fail(400, "Invalid token")));
    render(<ResetPasswordForm token="stale-token" />);

    await user.type(screen.getByLabelText("New Password"), "supersecret1!");
    await user.type(screen.getByLabelText("Confirm Password"), "supersecret1!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Invalid token")).toBeInTheDocument();
    expect(
      screen.queryByText(/Password updated! Redirecting you to login/i),
    ).toBeNull();
    expect(screen.getByLabelText("New Password")).toBeInTheDocument();
  });
});
