/**
 * @module web/tests/components/ContactPage
 * @description The public contact page: a server component that reads the
 * session only to prefill the form, and must render that form whether the read
 * succeeds, returns nothing, or throws.
 *
 * It lives in this directory rather than next to the page because the
 * happy-dom project's `include` list has no `app/**` pattern — a test placed
 * there would never run, and a pattern matching nothing looks exactly like a
 * directory with no tests in it.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));

vi.mock("../../lib/auth-client", () => ({
  authClient: { getSession: getSessionMock },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

import ContactPage from "../../app/contact/page";

beforeEach(() => {
  getSessionMock.mockReset();
});

describe("ContactPage", () => {
  it("renders the form for an anonymous visitor", async () => {
    getSessionMock.mockResolvedValue({ data: null });

    render(await ContactPage());

    expect(
      screen.getByRole("heading", { name: "Get in touch" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });

  it("prefills from the session when there is one", async () => {
    getSessionMock.mockResolvedValue({
      data: { user: { name: "Ada Lovelace", email: "ada@example.com" } },
    });

    render(await ContactPage());

    expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
  });

  it("still renders a usable form when the session read fails", async () => {
    // The prefill is a convenience. A page that needed the API up could not be
    // used to report the API being down.
    getSessionMock.mockRejectedValue(new Error("ECONNREFUSED"));

    render(await ContactPage());

    expect(
      screen.getByRole("heading", { name: "Get in touch" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });
});
