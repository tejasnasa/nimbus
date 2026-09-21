/**
 * @module api/__tests__/unit/email
 * @description Transactional email templates. Resend is mocked so nothing is
 * sent; what matters here is that the right recipient, subject, and action link
 * reach the provider, and how a provider-side failure is handled.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async () => ({ data: { id: "email-id" }, error: null })),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { sendEmail, sendPasswordResetEmail } from "../../lib/email";

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
