/**
 * @module web/tests/components/ContactForm
 * @description The contact form as a user meets it: pick a category, fill the
 * fields, submit, and land on the confirmation. The failure path is exercised
 * against a real failure envelope, because "the message could not be sent" is
 * the one thing this form must never get wrong.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { fail } from "../msw/handlers";
import { BACKEND_URL, preflight } from "./testUtils";
import ContactForm from "../../components/ContactForm";

const CONTACT_URL = `${BACKEND_URL}/api/contact`;

beforeEach(() => {
  server.use(preflight);
});

/** Fills the form with a valid submission. */
async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: /category/i }));
  await user.click(screen.getByRole("option", { name: "Bug report" }));
  await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(
    screen.getByLabelText("Message"),
    "The canvas drops my last stroke when I reload.",
  );
}

describe("ContactForm", () => {
  it("sends the submission and swaps itself for the confirmation", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post(CONTACT_URL, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          success: true,
          message: "Message sent",
          responseObject: null,
          statusCode: 200,
        });
      }),
    );
    render(<ContactForm />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Message sent")).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({
      category: "bug",
      name: "Ada Lovelace",
      message: "The canvas drops my last stroke when I reload.",
    });
    expect(
      screen.queryByRole("button", { name: "Send message" }),
    ).not.toBeInTheDocument();
  });

  it("returns to an empty form from the confirmation", async () => {
    const user = userEvent.setup();
    server.use(http.post(CONTACT_URL, () => HttpResponse.json({ success: true })));
    render(<ContactForm prefill={{ name: "Ada Lovelace" }} />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Message sent");

    await user.click(screen.getByRole("button", { name: "Send another message" }));

    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("");
    // The prefill survives, so the second message is not retyped.
    expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
  });

  it("shows the validation message without calling the API", async () => {
    const user = userEvent.setup();
    let called = false;
    server.use(
      http.post(CONTACT_URL, () => {
        called = true;
        return HttpResponse.json({ success: true });
      }),
    );
    render(<ContactForm />);

    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Choose a category.")).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("tells the sender when the message could not be sent", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(CONTACT_URL, () =>
        fail(502, "Could not send your message. Please try again."),
      ),
    );
    render(<ContactForm />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      await screen.findByText("Could not send your message. Please try again."),
    ).toBeInTheDocument();
    // Still on the form — nothing is claimed to have been sent.
    expect(screen.queryByText("Message sent")).not.toBeInTheDocument();
  });

  it("prefills the fields it is given", () => {
    render(
      <ContactForm
        prefill={{ name: "Ada Lovelace", email: "ada@example.com" }}
      />,
    );

    expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
  });

  it("keeps the honeypot in the DOM but out of the accessibility tree", () => {
    render(<ContactForm />);

    const honeypot = document.querySelector<HTMLInputElement>("#nimbus_hp");

    expect(honeypot).toBeTruthy();
    // Present and fillable by a form parser, which is the point: `display:none`
    // would be skipped by the bots this field exists to catch.
    expect(honeypot!.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(honeypot!.tabIndex).toBe(-1);
    expect(
      screen.queryByRole("textbox", { name: /leave this field empty/i }),
    ).toBeNull();
  });
});
