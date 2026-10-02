/**
 * @module api/__tests__/integration/http/contact
 * @description The public contact endpoint: it hands one email to the provider
 * and persists nothing. The route reads no session and touches neither
 * Postgres nor Redis, so this file needs no database fixture — `afterAll` still
 * closes the shared clients `createApp()` constructs at import.
 *
 * `resend` is mocked at the module boundary by the test setup, so nothing
 * reaches the provider. What is asserted is the payload it was handed, and how
 * each failure is mapped onto a status.
 */
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app";
import { closeTestResources, getResendSendMock } from "@testhelpers";

const app = createApp();

afterAll(closeTestResources);

/** A submission that satisfies every field constraint. */
const validBody = {
  category: "bug",
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "The canvas drops my last stroke when I reload the page.",
  nimbus_hp: "",
};

const post = (body: Record<string, unknown> = validBody) =>
  request(app).post("/api/contact").send(body);

/** The payload handed to the provider by the most recent send. */
const lastPayload = () =>
  getResendSendMock().mock.calls.at(-1)?.[0] as Record<string, string>;

beforeEach(() => {
  getResendSendMock().mockClear();
  getResendSendMock().mockResolvedValue({
    data: { id: "test-email-id" },
    error: null,
  });
  // Every failure path logs by design; the assertions below are about the
  // status and the payload, so the log lines are silenced rather than removed.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("http: contact", () => {
  it("emails the configured operator and answers 200", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      statusCode: 200,
      responseObject: null,
    });
    expect(getResendSendMock()).toHaveBeenCalledTimes(1);
    expect(lastPayload()).toMatchObject({
      from: "noreply@tejasnasa.me",
      to: process.env.CONTACT_TO_EMAIL,
    });
  });

  it("carries the submitter as the reply target", async () => {
    await post();

    expect(lastPayload().replyTo).toBe("ada@example.com");
  });

  it("puts the category in the subject and no user text", async () => {
    await post();

    expect(lastPayload().subject).toBe("[Nimbus Contact] Bug report");
    expect(lastPayload().subject).not.toContain("Ada Lovelace");
    expect(lastPayload().subject).not.toContain("drops my last stroke");
  });

  it("carries the message in both the text and html parts", async () => {
    await post();

    expect(lastPayload().text).toContain(validBody.message);
    expect(lastPayload().html).toContain(validBody.message);
  });

  it("accepts a multi-line message", async () => {
    const message = "Step one.\nStep two.\n\tStep three.";

    const res = await post({ ...validBody, message });

    expect(res.status).toBe(200);
    expect(lastPayload().text).toContain(message);
  });

  it("reads the recipient from the environment at call time", async () => {
    const original = process.env.CONTACT_TO_EMAIL;
    process.env.CONTACT_TO_EMAIL = "someone-else@example.com";

    try {
      await post();

      expect(lastPayload().to).toBe("someone-else@example.com");
    } finally {
      process.env.CONTACT_TO_EMAIL = original;
    }
  });

  it("answers 400 for a category outside the list", async () => {
    const res = await post({ ...validBody, category: "compliment" });

    expect(res.status).toBe(400);
    expect(getResendSendMock()).not.toHaveBeenCalled();
  });

  it("answers 400 for a message below the minimum length", async () => {
    const res = await post({ ...validBody, message: "too short" });

    expect(res.status).toBe(400);
    expect(getResendSendMock()).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed sender address", async () => {
    const res = await post({ ...validBody, email: "not-an-address" });

    expect(res.status).toBe(400);
    expect(getResendSendMock()).not.toHaveBeenCalled();
  });

  it("answers 503 and sends nothing when the recipient is unconfigured", async () => {
    const original = process.env.CONTACT_TO_EMAIL;
    delete process.env.CONTACT_TO_EMAIL;

    try {
      const res = await post();

      expect(res.status).toBe(503);
      expect(getResendSendMock()).not.toHaveBeenCalled();
    } finally {
      process.env.CONTACT_TO_EMAIL = original;
    }
  });

  it("answers 502 when the provider rejects the send, without leaking its message", async () => {
    getResendSendMock().mockResolvedValueOnce({
      data: null,
      error: {
        name: "validation_error",
        message: "API key is invalid",
        statusCode: 403,
      },
    });

    const res = await post();

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ success: false, statusCode: 502 });
    // The provider's own wording belongs in the log, not in the response.
    expect(JSON.stringify(res.body)).not.toContain("API key is invalid");
  });

  it("answers 502 when the request never reaches the provider", async () => {
    getResendSendMock().mockRejectedValueOnce(
      new Error("ECONNREFUSED 127.0.0.1:443"),
    );

    const res = await post();

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/could not send/i);
  });

  it("answers 504 when the provider call times out", async () => {
    const timeout = new Error("The operation was aborted");
    timeout.name = "TimeoutError";
    getResendSendMock().mockRejectedValueOnce(timeout);

    const res = await post();

    expect(res.status).toBe(504);
    expect(res.body).toMatchObject({ success: false, statusCode: 504 });
  });
});
