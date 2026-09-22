/**
 * @module api/lib/cookieAttributes
 * @description Derives better-auth's session-cookie attributes from the API's
 * base URL. Production-shaped attributes that ignore the base URL (`secure`
 * over plain HTTP, a `Domain` that doesn't match `localhost`) make the cookie
 * refuse to be stored at all in a local browser — sign-in returns 200 and no
 * session is ever persisted.
 *
 * @important The derived attributes are coupled to `BETTER_AUTH_URL` by
 *            construction. A change to that variable changes cookie behaviour;
 *            the resolved values are logged at boot so the coupling is
 *            observable rather than silent.
 *
 * @important Exported as a pure function so the cases (HTTPS-with-domain,
 *            HTTPS-without-domain, HTTP, malformed input) are unit-testable
 *            without booting the app — supertest ignores `Domain`/`Secure`
 *            entirely, so this is the only way the cases get real coverage.
 */

/**
 * The shape returned by {@link resolveCookieAttributes}. Mirrors better-auth's
 * `advanced.defaultCookieAttributes` and `advanced.crossSubDomainCookies` —
 * fields are only present when they should be applied, so the caller passes
 * the spread straight through.
 */
export type ResolvedCookieAttributes = {
  /** The `sameSite` attribute. Always `lax` for this app. */
  sameSite: "lax";
  /** The `secure` flag, set only for HTTPS base URLs. */
  secure?: true;
  /** The `domain` for `defaultCookieAttributes` (single-host HTTPS, no subdomain scope). */
  domain?: string;
  /** The `crossSubDomainCookies` block, when a cross-subdomain scope is requested. */
  crossSubDomainCookies?: { enabled: true; domain: string };
};

/**
 * Parameters for {@link resolveCookieAttributes}.
 */
export type ResolveCookieAttributesParams = {
  /** The API base URL, e.g. `http://localhost:3001` or `https://api.tejasnasa.me`. */
  baseUrl: string;
  /**
   * Optional cross-subdomain scope, e.g. `.tejasnasa.me`. When set, the cookie
   * is shared across subdomains via `crossSubDomainCookies`. Omitted when the
   * base URL is plain HTTP — `Secure` and cross-subdomain cookies are mutually
   * meaningless over HTTP.
   */
  cookieDomain?: string;
};

/**
 * Derives the session-cookie attributes from the API base URL.
 *
 * @param params - The base URL and optional cross-subdomain scope.
 * @returns The attributes ready to spread into better-auth's `advanced`.
 *
 * @remarks
 * - `http:` → `{ sameSite: "lax" }` only. `Secure` and `Domain` are omitted.
 * - `https:` → `{ sameSite: "lax", secure: true }`. If `cookieDomain` is set,
 *   `crossSubDomainCookies` is returned alongside — do not also set
 *   `defaultCookieAttributes.domain` (the two will fight, per better-auth's
 *   design intent).
 * - Any other scheme, or a malformed base URL, returns the safe HTTP-shape
 *   attributes — the server still works, and the failure is logged at boot
 *   rather than throwing, since this is a boot-time decision not a request-time
 *   one.
 */
export function resolveCookieAttributes(
  params: ResolveCookieAttributesParams,
): ResolvedCookieAttributes {
  const { baseUrl, cookieDomain } = params;

  // Parse defensively: a malformed base URL should not crash boot. Better to
  // fall back to the safest possible cookie shape than to refuse to start.
  let protocol: string | null = null;
  try {
    protocol = new URL(baseUrl).protocol;
  } catch {
    protocol = null;
  }

  if (protocol === "https:") {
    return {
      sameSite: "lax",
      secure: true,
      // Only attach the cross-subdomain block when a domain was actually
      // configured; otherwise the caller passes through a single-host HTTPS
      // shape — `secure` with no `domain` — which a cross-subdomain block
      // cannot express.
      ...(cookieDomain
        ? {
          crossSubDomainCookies: {
            enabled: true as const,
            domain: cookieDomain,
          },
        }
        : {}),
    };
  }

  // `http:` (or anything else — protocol === "http:" or null) gets the lax
  // plain shape. `Secure` is deliberately not set, since `Secure` over HTTP
  // makes the browser refuse to store the cookie at all.
  return { sameSite: "lax" };
}

/**
 * Renders the resolved attributes for the boot log, so the implicit coupling
 * between `BETTER_AUTH_URL` and cookie behaviour is observable.
 *
 * @param attrs - The resolved attributes.
 * @returns A short, single-line summary suitable for `console.log` at boot.
 */
export function describeCookieAttributes(attrs: ResolvedCookieAttributes): string {
  const parts: string[] = [`sameSite=${attrs.sameSite}`];
  if (attrs.secure) parts.push("secure");
  if (attrs.domain) parts.push(`domain=${attrs.domain}`);
  if (attrs.crossSubDomainCookies) {
    parts.push(
      `crossSubDomainCookies=${attrs.crossSubDomainCookies.domain}`,
    );
  }
  return parts.join(" ");
}
