/**
 * @module api/__tests__/unit/email
 * @description Transactional email templates. Resend is mocked so nothing is
 * sent; what matters here is that the right recipient, subject, and action link
 * reach the provider, and how a provider-side failure is handled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async () => ({ data: { id: "email-id" }, error: null })),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import {
  ContactMailError,
  sendContactEmail,
  sendEmail,
  sendPasswordResetEmail,
} from "../../lib/email";

const lastPayload = () =>
  sendMock.mock.calls.at(-1)?.[0] as Record<string, string>;

describe("lib/email", () => {
  beforeEach(() => {
    sendMock.mockClear();
    sendMock.mockResolvedValue({ data: { id: "email-id" }, error: null });
  });

  describe("sendEmail (verification)", () => {
    it("sends to the given recipient from the fixed sender", async () => {
      await sendEmail({
        to: "user@example.test",
        url: "https://nimbus.test/verify?token=abc",
      });

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(lastPayload()).toMatchObject({
        to: "user@example.test",
        from: "noreply@tejasnasa.me",
      });
    });

    it("asks the recipient to verify their address", async () => {
      await sendEmail({
        to: "user@example.test",
        url: "https://nimbus.test/verify",
      });

      expect(lastPayload().subject).toMatch(/verify your nimbus email/i);
    });

    it("embeds the verification link in the body", async () => {
      const url = "https://nimbus.test/verify?token=abc123";
      await sendEmail({ to: "user@example.test", url });

      expect(lastPayload().html).toContain(url);
    });
  });

  describe("sendPasswordResetEmail", () => {
    it("sends a reset link with its own subject", async () => {
      const url = "https://nimbus.test/reset?token=xyz";
      await sendPasswordResetEmail({ to: "user@example.test", url });

      expect(lastPayload()).toMatchObject({ to: "user@example.test" });
      expect(lastPayload().subject).toMatch(/reset your nimbus password/i);
      expect(lastPayload().html).toContain(url);
    });
  });

  describe("provider failures", () => {
    /**
     * Pins CURRENT behaviour, and it is not good: the SDK resolves with an
     * `error` field rather than throwing, and neither function inspects it. A
     * failed send is indistinguishable from a successful one. Verified upstream
     * too — sign-up returns 200 with a deliberately invalid API key.
     */
    it("resolves without throwing when the provider returns an error", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      sendMock.mockResolvedValueOnce({
        data: null,
        error: { name: "validation_error", message: "API key is invalid" },
      });

      await expect(
        sendEmail({
          to: "user@example.test",
          url: "https://nimbus.test/verify",
        }),
      ).resolves.toBeUndefined();
      // The error branch of `deliver()` logs; this test exercises that branch
      // without inspecting the log, but spy is installed to silence stderr.
      expect(errorSpy).toHaveBeenCalled();
    });

    /**
     * `deliver()` logs both branches of failure (resolved-with-error and
     * rejected-promise). The log is the only signal that an email was not
     * delivered — sign-up returns 200 either way — so without these calls the
     * `console.error` paths would be uncovered and a real outage would have no
     * log trail to grep for.
     */
    it("logs when the provider returns an error", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      sendMock.mockResolvedValueOnce({
        data: null,
        error: { name: "validation_error", message: "API key is invalid" },
      });

      await sendEmail({
        to: "user@example.test",
        url: "https://nimbus.test/verify",
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, err] = errorSpy.mock.calls[0]!;
      expect(message).toMatch(/email verification/);
      expect(message).toMatch(/check RESEND_API_KEY/);
      expect(err).toMatchObject({ name: "validation_error" });
    });

    it("logs when the SDK itself throws before reaching Resend", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      sendMock.mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1:443"));

      await sendPasswordResetEmail({
        to: "user@example.test",
        url: "https://nimbus.test/reset",
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]![0]).toMatch(/password reset/);
      expect(errorSpy.mock.calls[0]![0]).toMatch(/before reaching Resend/);
    });

    it("resolves without throwing when the SDK rejects", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      sendMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(
        sendEmail({
          to: "user@example.test",
          url: "https://nimbus.test/verify",
        }),
      ).resolves.toBeUndefined();
    });
  });
});

/** A contact submission; override the field under test. */
const submission = (
  overrides: Partial<Parameters<typeof sendContactEmail>[0]> = {},
) => ({
  to: "operator@example.com",
  category: "bug" as const,
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "The canvas drops my last stroke when I reload the page.",
  ...overrides,
});

describe("sendContactEmail", () => {
  beforeEach(() => {
    sendMock.mockClear();
    sendMock.mockResolvedValue({ data: { id: "email-id" }, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("addresses the operator, labels the subject and replies to the sender", async () => {
    await sendContactEmail(submission());

    expect(lastPayload()).toMatchObject({
      from: "noreply@tejasnasa.me",
      to: "operator@example.com",
      replyTo: "ada@example.com",
      subject: "[Nimbus Contact] Bug report",
    });
  });

  it("carries the message in both parts, escaping only the html one", async () => {
    const message = "Steps: <b>1</b> open </script> and press & hold";

    await sendContactEmail(submission({ message }));

    expect(lastPayload().text).toContain(message);
    expect(lastPayload().html).toContain("&lt;b&gt;1&lt;/b&gt;");
    expect(lastPayload().html).toContain("&amp;");
  });

  it("escapes the name into the html and keeps it raw in the text part", async () => {
    const name = "<script>alert(1)</script>";

    await sendContactEmail(submission({ name }));

    expect(lastPayload().html).toContain("&lt;script&gt;");
    expect(lastPayload().html).not.toContain("<script>");
    expect(lastPayload().text).toContain(name);
  });

  it("renders newlines with pre-wrap rather than swapping them for <br>", async () => {
    const message = "line one\nline two";

    await sendContactEmail(submission({ message }));

    expect(lastPayload().html).toContain("white-space: pre-wrap");
    expect(lastPayload().html).toContain(message);
    expect(lastPayload().html).not.toContain("<br");
  });

  it("throws upstream when the provider reports an error", async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: {
        name: "validation_error",
        message: "API key is invalid",
        statusCode: 403,
      },
    });

    await expect(sendContactEmail(submission())).rejects.toMatchObject({
      reason: "upstream",
    });
  });

  it("throws upstream when the request never reaches the provider", async () => {
    sendMock.mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1:443"));

    await expect(sendContactEmail(submission())).rejects.toMatchObject({
      reason: "upstream",
    });
  });

  it("reports a rejection that is not an Error at all", async () => {
    // The SDK rejects with whatever `fetch` threw; a non-Error is unlikely but
    // would otherwise leave the log line empty.
    sendMock.mockRejectedValueOnce("boom");

    await expect(sendContactEmail(submission())).rejects.toMatchObject({
      reason: "upstream",
      message: "boom",
    });
  });

  it("maps a platform timeout onto the timeout reason", async () => {
    const aborted = new Error("The operation was aborted");
    aborted.name = "TimeoutError";
    sendMock.mockRejectedValueOnce(aborted);

    await expect(sendContactEmail(submission())).rejects.toMatchObject({
      reason: "timeout",
    });
  });

  it("gives up on a provider call that never answers", async () => {
    // The SDK exposes neither a timeout nor an abort signal, so without the
    // race inside the module an unresponsive provider holds the sender's
    // request open indefinitely.
    vi.useFakeTimers();

    try {
      sendMock.mockImplementationOnce(() => new Promise(() => {}));

      const pending = sendContactEmail(submission());
      const rejected = expect(pending).rejects.toMatchObject({
        reason: "timeout",
      });

      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails loudly where the account flows deliberately stay quiet", async () => {
    // Opposite contracts, on purpose: a failed verification email must not fail
    // a signup that already created its account row, while a contact email is
    // the whole outcome of its request.
    vi.spyOn(console, "error").mockImplementation(() => {});

    sendMock.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "nope", statusCode: 403 },
    });
    await expect(
      sendEmail({ to: "user@example.test", url: "https://nimbus.test/verify" }),
    ).resolves.toBeUndefined();

    sendMock.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "nope", statusCode: 403 },
    });
    await expect(sendContactEmail(submission())).rejects.toBeInstanceOf(
      ContactMailError,
    );
  });
});
