/**
 * @module api/__tests__/unit/turnCredentials
 * @description Pins the coturn `use-auth-secret` credential scheme: a
 * `<expiry>:<userId>` username with a 24h TTL, authenticated by a base64
 * HMAC-SHA1 over `TURN_SECRET`.
 *
 * Coturn rejects expired usernames by parsing the expiry prefix, so the format
 * is a wire contract, not an implementation detail.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateTurnCredentials } from "../../lib/turnCredentials";

const SECRET = "unit-test-turn-secret";
const TTL_SECONDS = 86_400;

describe("lib/turnCredentials", () => {
  beforeEach(() => {
    process.env.TURN_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.TURN_SECRET;
  });

  it("formats the username as <expiry-unix-ts>:<userId>", () => {
    const { username } = generateTurnCredentials("user-123");
    const [expiry, userId] = username.split(":");

    expect(userId).toBe("user-123");
    expect(expiry).toMatch(/^\d+$/);
  });

  it("sets the expiry ~24h in the future", () => {
    const before = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    const { username } = generateTurnCredentials("user-123");
    const after = Math.floor(Date.now() / 1000) + TTL_SECONDS;

    const expiry = Number(username.split(":")[0]);
    expect(expiry).toBeGreaterThanOrEqual(before);
    expect(expiry).toBeLessThanOrEqual(after);
  });

  it("signs the username with base64 HMAC-SHA1 keyed on TURN_SECRET", () => {
    const { username, credential } = generateTurnCredentials("user-123");

    const expected = createHmac("sha1", SECRET).update(username).digest("base64");
    expect(credential).toBe(expected);
  });

  it("binds the credential to the username, so it can't be replayed for another user", () => {
    const a = generateTurnCredentials("user-a");
    const b = generateTurnCredentials("user-b");

    expect(a.credential).not.toBe(b.credential);
    // Re-signing b's username with a's credential would not verify.
    const forged = createHmac("sha1", SECRET).update(a.username).digest("base64");
    expect(forged).not.toBe(b.credential);
  });

  // Pins CURRENT behaviour. A missing secret is not validated at boot; the
  // non-null assertion is erased at runtime and createHmac throws on undefined,
  // which the controller surfaces as a 500 on first use.
  it("throws when TURN_SECRET is unset (fails at request time, not at boot)", () => {
    delete process.env.TURN_SECRET;

    expect(() => generateTurnCredentials("user-123")).toThrow(
      /key.*must be of type string/i,
    );
  });
});
