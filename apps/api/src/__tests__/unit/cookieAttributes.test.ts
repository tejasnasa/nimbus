/**
 * @module api/__tests__/unit/cookieAttributes
 * @description Derivation of better-auth's session-cookie attributes from the
 * API base URL. The whole point of Phase 0 (errors.md #13) is that a real
 * browser refuses the wrong shape — `supertest` ignores `Domain`/`Secure`
 * entirely, so these are the only tests that can pin the four cases without
 * booting a browser.
 */
import { describe, expect, it } from "vitest";
import {
  describeCookieAttributes,
  resolveCookieAttributes,
  type ResolvedCookieAttributes,
} from "../../lib/cookieAttributes";

describe("lib/cookieAttributes", () => {
  describe("resolveCookieAttributes", () => {
    it("omits both `secure` and `domain` for an HTTP localhost base URL", () => {
      // The case errors.md #13 describes: a production-shaped cookie over
      // localhost is silently rejected by every real browser, so the localhost
      // shape must be plain lax.
      const attrs = resolveCookieAttributes({
        baseUrl: "http://localhost:3001",
      });

      expect(attrs).toEqual({ sameSite: "lax" });
      expect(attrs.secure).toBeUndefined();
      expect(attrs.domain).toBeUndefined();
      expect(attrs.crossSubDomainCookies).toBeUndefined();
    });

    it("sets `secure` and a `crossSubDomainCookies` block for HTTPS with a domain", () => {
      const attrs = resolveCookieAttributes({
        baseUrl: "https://api.tejasnasa.me",
        cookieDomain: ".tejasnasa.me",
      });

      expect(attrs.sameSite).toBe("lax");
      expect(attrs.secure).toBe(true);
      expect(attrs.crossSubDomainCookies).toEqual({
        enabled: true,
        domain: ".tejasnasa.me",
      });
      // The plan: never set both `defaultCookieAttributes.domain` and
      // `crossSubDomainCookies.domain` — they fight by better-auth's design.
      expect(attrs.domain).toBeUndefined();
    });

    it("sets `secure` but omits `domain` for HTTPS without a configured domain", () => {
      // The case errors.md #13 notes its option 1 cannot express — a single
      // HTTPS host that does not need cross-subdomain scope.
      const attrs = resolveCookieAttributes({
        baseUrl: "https://api.example.com",
      });

      expect(attrs.sameSite).toBe("lax");
      expect(attrs.secure).toBe(true);
      expect(attrs.domain).toBeUndefined();
      expect(attrs.crossSubDomainCookies).toBeUndefined();
    });

    it("ignores a configured `cookieDomain` over an HTTP base URL", () => {
      // A cross-subdomain cookie over HTTP is meaningless (browsers ignore
      // `Domain` matching for cross-site contexts without `Secure`), and
      // `Secure` over HTTP makes the cookie unstored. So an HTTP base URL
      // always gets the plain shape regardless of `cookieDomain`.
      const attrs = resolveCookieAttributes({
        baseUrl: "http://localhost:3001",
        cookieDomain: ".tejasnasa.me",
      });

      expect(attrs).toEqual({ sameSite: "lax" });
      expect(attrs.crossSubDomainCookies).toBeUndefined();
    });

    it("falls back to the safe plain shape when the base URL is malformed", () => {
      // A malformed base URL should not crash boot — better-auth still
      // starts, and the cookie shape is at least not actively wrong.
      const attrs = resolveCookieAttributes({
        baseUrl: "not a url",
      });

      expect(attrs).toEqual({ sameSite: "lax" });
      expect(attrs.secure).toBeUndefined();
    });

    it("falls back to the safe plain shape for an unknown scheme", () => {
      // file://, ws://, ftp://, … none of them are valid base URLs. The
      // fallback is the same as the HTTP case.
      const attrs = resolveCookieAttributes({
        baseUrl: "ftp://api.example.com",
      });

      expect(attrs).toEqual({ sameSite: "lax" });
      expect(attrs.secure).toBeUndefined();
    });

    it("always uses `sameSite: lax` for the shapes this app issues", () => {
      // Cross-cutting: `lax` is the only `sameSite` value better-auth supports
      // for session cookies that has to survive a top-level navigation from
      // the email-verification / password-reset callback. The plan does not
      // change this.
      const shapes: ResolvedCookieAttributes[] = [
        resolveCookieAttributes({ baseUrl: "http://localhost:3001" }),
        resolveCookieAttributes({
          baseUrl: "https://api.tejasnasa.me",
          cookieDomain: ".tejasnasa.me",
        }),
        resolveCookieAttributes({ baseUrl: "https://api.example.com" }),
        resolveCookieAttributes({ baseUrl: "not a url" }),
      ];

      for (const shape of shapes) {
        expect(shape.sameSite).toBe("lax");
      }
    });
  });

  describe("describeCookieAttributes", () => {
    it("lists each present field with a stable ordering", () => {
      // The boot log reads this string, so the ordering is part of the
      // observable contract: `sameSite` first, then `secure`, then `domain`,
      // then `crossSubDomainCookies` last.
      const described = describeCookieAttributes({
        sameSite: "lax",
        secure: true,
        crossSubDomainCookies: { enabled: true, domain: ".tejasnasa.me" },
      });

      expect(described).toBe(
        "sameSite=lax secure crossSubDomainCookies=.tejasnasa.me",
      );
    });

    it("renders the plain HTTP shape compactly", () => {
      const described = describeCookieAttributes({ sameSite: "lax" });

      expect(described).toBe("sameSite=lax");
    });
  });
});
