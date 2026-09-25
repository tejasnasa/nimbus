/**
 * @module api/__tests__/unit/authCookieConfig
 * @description Pins *where* the cross-subdomain cookie block is handed to
 * better-auth, as opposed to what it contains.
 *
 * The derivation from `BETTER_AUTH_URL` is covered by `cookieAttributes.test.ts`.
 * That file cannot catch a wiring mistake: better-auth only reads
 * `advanced.crossSubDomainCookies.enabled`, so a correctly-computed block placed
 * one level deeper — inside `advanced.defaultCookieAttributes` — is read by
 * nobody and silently produces a host-only cookie. Nothing throws and the boot
 * log still reports the resolved values, because it echoes the derivation rather
 * than the config better-auth actually received.
 *
 * `lib/auth.ts` reads the environment at module load, so each case stubs the
 * environment and re-imports the module graph rather than mutating a shared
 * instance.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** Loads a fresh `auth` instance under `env` and returns its resolved options. */
const loadAuthOptions = async (env: Record<string, string>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

  const { auth } = await import("../../lib/auth");

  return (auth as unknown as { options: Record<string, any> }).options;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("unit: auth cookie config", () => {
  it("hands crossSubDomainCookies to better-auth at the advanced level", async () => {
    const options = await loadAuthOptions({
      BETTER_AUTH_URL: "https://nimbus-api.tejasnasa.me",
      AUTH_COOKIE_DOMAIN: ".tejasnasa.me",
    });

    expect(options.advanced.crossSubDomainCookies).toEqual({
      enabled: true,
      domain: ".tejasnasa.me",
    });

    // The regression this file exists for: the same block nested inside the
    // attribute bag is inert, because better-auth never looks for it there.
    expect(options.advanced.defaultCookieAttributes).not.toHaveProperty(
      "crossSubDomainCookies",
    );
  });

  it("keeps secure cookies over HTTPS while omitting the subdomain scope", async () => {
    const options = await loadAuthOptions({
      BETTER_AUTH_URL: "https://nimbus-api.tejasnasa.me",
      AUTH_COOKIE_DOMAIN: "",
    });

    expect(options.advanced.crossSubDomainCookies).toBeUndefined();
    expect(options.advanced.defaultCookieAttributes.secure).toBe(true);
    expect(options.advanced.defaultCookieAttributes).not.toHaveProperty("domain");
  });

  it("omits secure and the subdomain scope for a plain-HTTP base URL", async () => {
    const options = await loadAuthOptions({
      BETTER_AUTH_URL: "http://localhost:3001",
      AUTH_COOKIE_DOMAIN: ".tejasnasa.me",
    });

    expect(options.advanced.crossSubDomainCookies).toBeUndefined();
    expect(options.advanced.defaultCookieAttributes).not.toHaveProperty("secure");
  });
});
