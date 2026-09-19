/**
 * @module web/tests/components/ForgotPasswordForm
 * @description Reset-request card. It owns `useForgotPasswordForm`, so these
 * tests drive the real hook: client-side validation must block the request, a
 * successful request swaps the form for the "check your inbox" confirmation, and
 * a rejected request must surface the server's message rather than silently
 * staying put.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { preflight, BACKEND_URL, FRONTEND_URL } from "./testUtils";
import { fail } from "../msw/handlers";
import ForgotPasswordForm from "../../components/ForgotPasswordForm";

const requestPasswordReset = () =>
  http.post(`${BACKEND_URL}/api/auth/request-password-reset`, () =>
    HttpResponse.json({ status: true }),
  );

beforeEach(() => {
  server.use(preflight, requestPasswordReset());
});

describe("ForgotPasswordForm", () => {
  it("blocks the request when the email is not valid", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post(
        `${BACKEND_URL}/api/auth/request-password-reset`,
        async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json({ status: true });
        },
      ),
    );
    render(<ForgotPasswordForm openLogin={vi.fn()} />);

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it("confirms that a reset link was sent", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post(
        `${BACKEND_URL}/api/auth/request-password-reset`,
        async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json({ status: true });
        },
      ),
    );
    render(<ForgotPasswordForm openLogin={vi.fn()} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(
      await screen.findByText(
        /If an account exists for that email, a reset link has been sent/i,
      ),
    ).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({
      email: "ada@example.com",
      redirectTo: `${FRONTEND_URL}/reset-password`,
    });
  });

  it("replaces the form with the confirmation, so the email cannot be resubmitted", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm openLogin={vi.fn()} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await screen.findByText(/a reset link has been sent/i);
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("returns to login from the confirmation screen", async () => {
    const user = userEvent.setup();
    const openLogin = vi.fn();
    render(<ForgotPasswordForm openLogin={openLogin} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await user.click(
      await screen.findByRole("button", { name: "Back to login" }),
    );

    expect(openLogin).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's message when the request is rejected", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${BACKEND_URL}/api/auth/request-password-reset`, () =>
        fail(500, "Mailer unavailable"),
      ),
    );
    render(<ForgotPasswordForm openLogin={vi.fn()} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("Mailer unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/a reset link has been sent/i)).toBeNull();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});
