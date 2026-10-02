/**
 * @module api/__tests__/security/contact
 * @description The public contact route's security-facing behaviour: it is the
 * one REST endpoint an anonymous caller can reach, it is not a relay for a
 * cross-site form post, and the HTML it produces cannot be shaped by the
 * submission.
 *
 * This file is the counterpart to `guards.security.test.ts`, which asserts that
 * every *other* route answers 401 to an anonymous caller. The contact route is
 * deliberately absent from that matrix — adding it there would make the matrix
 * describe something untrue.
 */
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import { closeTestResources, getResendSendMock } from "@testhelpers";

const app = createApp();

afterAll(closeTestResources);

const validBody = {
  category: "question",
  name: "Grace Hopper",
  email: "grace@example.com",
  message: "Does the canvas support keyboard-only navigation?",
  nimbus_hp: "",
};

const post = (body: Record<string, unknown> = validBody) =>
  request(app).post("/api/contact").send(body);

const lastPayload = () =>
  getResendSendMock().mock.calls.at(-1)?.[0] as Record<string, string>;

beforeEach(() => {
  getResendSendMock().mockClear();
  getResendSendMock().mockResolvedValue({
    data: { id: "test-email-id" },
    error: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("security: contact", () => {
  it("answers an anonymous caller rather than demanding a session", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(getResendSendMock()).toHaveBeenCalledTimes(1);
  });

  it("discards a submission whose honeypot is filled, indistinguishably", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const real = await post();
    const sendsAfterReal = getResendSendMock().mock.calls.length;

    const trapped = await post({
      ...validBody,
      nimbus_hp: "https://spam.example/offer",
    });

    // Same status and same envelope: a bot must not be able to tell the
    // honeypot fired, or it learns which field to leave alone.
    expect(trapped.status).toBe(real.status);
    expect(trapped.body).toEqual(real.body);
    expect(getResendSendMock().mock.calls.length).toBe(sendsAfterReal);
    // The log is the only signal that this happened, and therefore the only
    // way to diagnose an autofill false positive.
    expect(warn).toHaveBeenCalled();
  });

  it("escapes the submission into the html part and keeps the text part raw", async () => {
    const name = "<script>alert(1)</script>";
    const message = "Steps: <b>1</b> open </script> and press & hold";

    await post({ ...validBody, name, message });

    const payload = lastPayload();

    expect(payload.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(payload.html).not.toContain(name);
    // The text alternative is meant to be faithful: escaping it as well would
    // fill it with literal entities for no benefit.
    expect(payload.text).toContain(name);
    expect(payload.text).toContain(message);
  });

  it("rejects a form-encoded body, so a cross-site form post cannot send mail", async () => {
    // A urlencoded body is a CORS *simple* request — a browser sends it with no
    // preflight — so this content type, not a CSRF token, is what stops another
    // origin from using the form as a relay.
    const res = await request(app)
      .post("/api/contact")
      .type("form")
      .send({ ...validBody });

    expect(res.status).toBe(400);
    expect(getResendSendMock()).not.toHaveBeenCalled();
  });

  it("caps the request body at the JSON parser's limit", async () => {
    const res = await post({ ...validBody, message: "x".repeat(200_000) });

    // 413 from `express.json()`'s own ceiling, which the terminal error handler
    // passes through rather than reporting as a server fault. Nothing reaches
    // the provider either way.
    expect(res.status).toBe(413);
    expect(getResendSendMock()).not.toHaveBeenCalled();
  });
});
