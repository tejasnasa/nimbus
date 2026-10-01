/**
 * @module api/__tests__/unit/env
 * @description Contract of the boot-time environment validation.
 *
 * `parseEnv` is the single gate that decides whether the process starts, so what
 * matters here is that a complete environment passes through unchanged, that an
 * incomplete one fails with every offender named in one pass rather than one at
 * a time, and that an empty string counts as missing.
 */
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../lib/env";

/** A minimal environment that satisfies every required variable. */
const completeEnv = {
  DATABASE_URL: "postgresql://nimbus:nimbus@localhost:5434/nimbus_test",
  REDIS_URL: "redis://localhost:6381",
  BETTER_AUTH_SECRET: "secret",
  BETTER_AUTH_URL: "http://localhost:3001",
  FRONTEND_URL: "http://localhost:3000",
  BOT_USERID: "bot-user-id",
  TURN_SECRET: "turn-secret",
  RESEND_API_KEY: "resend-key",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  CLOUDINARY_CLOUD_NAME: "cloudinary-cloud",
  CLOUDINARY_API_KEY: "cloudinary-key",
  CLOUDINARY_API_SECRET: "cloudinary-secret",
  AI_CREDENTIAL_ENCRYPTION_KEY:
    "test-only-encryption-key-placeholder-not-a-real-credential",
} satisfies NodeJS.ProcessEnv;

describe("lib/env", () => {
  it("passes a complete environment through unchanged", () => {
    const parsed = parseEnv(completeEnv);

    expect(parsed.DATABASE_URL).toBe(completeEnv.DATABASE_URL);
    expect(parsed.BOT_USERID).toBe("bot-user-id");
    // Typed as a union rather than free text, so an unrecognised mode is caught
    // here instead of changing behaviour somewhere downstream.
    expect(parsed.NODE_ENV).toBe("development");
  });

  it("leaves variables it does not know about alone", () => {
    const parsed = parseEnv({ ...completeEnv, SOMETHING_ELSE: "kept" });

    expect(parsed).not.toHaveProperty("SOMETHING_ELSE");
  });

  it("refuses an environment missing a required variable, naming it", () => {
    const { BOT_USERID: _omitted, ...withoutBot } = completeEnv;

    expect(() => parseEnv(withoutBot)).toThrow(/BOT_USERID/);
  });

  it("names every missing variable in one pass rather than the first", () => {
    const {
      BOT_USERID: _bot,
      TURN_SECRET: _turn,
      REDIS_URL: _redis,
      ...incomplete
    } = completeEnv;

    // A boot that reports one problem per restart turns configuration into a
    // guessing game, so the whole list is expected.
    expect(() => parseEnv(incomplete)).toThrow(
      /BOT_USERID[\s\S]*TURN_SECRET[\s\S]*REDIS_URL|REDIS_URL[\s\S]*BOT_USERID/,
    );
  });

  it("treats an empty string as missing, not as a value", () => {
    expect(() => parseEnv({ ...completeEnv, TURN_SECRET: "" })).toThrow(
      /TURN_SECRET/,
    );
  });

  it("reports a non-object environment without crashing", () => {
    // Nothing sensible can be read from a non-object, so the issue is raised at
    // the root; the label must still be present rather than an empty path.
    expect(() => parseEnv("nonsense" as unknown as NodeJS.ProcessEnv)).toThrow(
      /\(root\)/,
    );
  });

  it("treats `AUTH_COOKIE_DOMAIN` as optional and surfaces it when set", () => {
    // A missing `AUTH_COOKIE_DOMAIN` must not block boot, since a
    // single-host HTTPS deployment (and every HTTP deployment, which uses the
    // domain only for `crossSubDomainCookies`) does not need one. When it is
    // set, the parsed env exposes it so `lib/cookieAttributes` can read it.
    const withoutDomain = parseEnv(completeEnv);
    expect(withoutDomain.AUTH_COOKIE_DOMAIN).toBeUndefined();

    const withDomain = parseEnv({
      ...completeEnv,
      AUTH_COOKIE_DOMAIN: ".tejasnasa.me",
    });
    expect(withDomain.AUTH_COOKIE_DOMAIN).toBe(".tejasnasa.me");
  });

  it("treats an empty `AUTH_COOKIE_DOMAIN` as missing, not as a value", () => {
    // Same rule as the rest of the optional block: an empty string is as
    // broken as an absent one, and accepting it would silently disable
    // `crossSubDomainCookies` downstream.
    expect(() => parseEnv({ ...completeEnv, AUTH_COOKIE_DOMAIN: "" })).toThrow(
      /AUTH_COOKIE_DOMAIN/,
    );
  });

  it("boots with no operator AI key", () => {
    // A BYOK-only deployment has no operator key. The boot must pass with
    // `AI_API_KEY` unset — the resolver refuses per-request for a user with
    // no credential of their own, and the rest of the API keeps serving.
    const { AI_API_KEY: _ai, ...aiFree } = completeEnv;

    const parsed = parseEnv(aiFree);
    expect(parsed.AI_API_KEY).toBeUndefined();
    // The defaults still apply.
    expect(parsed.AI_PROVIDER).toBe("deepseek");
    expect(parsed.AI_MODEL).toBe("deepseek-flash");
    expect(parsed.AI_FREE_DOC_LIMIT).toBe(5);
  });

  it("refuses to boot without `AI_CREDENTIAL_ENCRYPTION_KEY`", () => {
    // Required: stored provider keys are encrypted with it, so a process
    // without one cannot serve BYOK at all. Failing at boot names the
    // variable instead of surfacing as a per-request error later.
    const { AI_CREDENTIAL_ENCRYPTION_KEY: _enc, ...withoutKey } = completeEnv;

    expect(() => parseEnv(withoutKey)).toThrow(/AI_CREDENTIAL_ENCRYPTION_KEY/);
  });

  it("rejects a short `AI_CREDENTIAL_ENCRYPTION_KEY` and names it", () => {
    // At least 32 characters. The value is HKDF-derived to a 32-byte AES key,
    // so a short value is not a smaller key — it is a weak passphrase, and
    // boot must fail loudly rather than accept one.
    expect(() =>
      parseEnv({ ...completeEnv, AI_CREDENTIAL_ENCRYPTION_KEY: "short" }),
    ).toThrow(/AI_CREDENTIAL_ENCRYPTION_KEY/);
  });

  it("accepts a passphrase-style encryption key of at least 32 chars", () => {
    const parsed = parseEnv({
      ...completeEnv,
      AI_CREDENTIAL_ENCRYPTION_KEY: "long-passphrase-not-a-real-key-32chars",
    });
    expect(parsed.AI_CREDENTIAL_ENCRYPTION_KEY).toBe(
      "long-passphrase-not-a-real-key-32chars",
    );
  });

  it("coerces `AI_FREE_DOC_LIMIT` from a string and clamps to 0+", () => {
    // Operators tune the limit at deploy time; the value comes through as a
    // string (env vars always are) and zod's `coerce` reads it as a number.
    expect(
      parseEnv({ ...completeEnv, AI_FREE_DOC_LIMIT: "20" }).AI_FREE_DOC_LIMIT,
    ).toBe(20);
    expect(
      parseEnv({ ...completeEnv, AI_FREE_DOC_LIMIT: "0" }).AI_FREE_DOC_LIMIT,
    ).toBe(0);
  });

  it("rejects a negative `AI_FREE_DOC_LIMIT`", () => {
    // A negative limit would short-circuit every quota claim to "exhausted"
    // and disable the free tier entirely — almost certainly an operator typo.
    expect(() => parseEnv({ ...completeEnv, AI_FREE_DOC_LIMIT: "-1" })).toThrow(
      /AI_FREE_DOC_LIMIT/,
    );
  });
});
