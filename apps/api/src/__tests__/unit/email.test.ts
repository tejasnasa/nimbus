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

const lastPayload = () => sendMock.mock.calls.at(-1)?.[0] as Record<string, string>;

describe("lib/email", () => {
  beforeEach(() => {
    sendMock.mockClear();
    sendMock.mockResolvedValue({ data: { id: "email-id" }, error: null });
  });

  describe("sendEmail (verification)", () => {
    it("sends to the given recipient from the fixed sender", async () => {
      await sendEmail({ to: "user@example.test", url: "https://nimbus.test/verify?token=abc" });

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(lastPayload()).toMatchObject({
        to: "user@example.test",
        from: "noreply@tejasnasa.me",
      });
    });

    it("asks the recipient to verify their address", async () => {
      await sendEmail({ to: "user@example.test", url: "https://nimbus.test/verify" });

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
      sendMock.mockResolvedValueOnce({
        data: null,
        error: { name: "validation_error", message: "API key is invalid" },
      });

      await expect(
        sendEmail({ to: "user@example.test", url: "https://nimbus.test/verify" }),
      ).resolves.toBeUndefined();
    });
  });
});
