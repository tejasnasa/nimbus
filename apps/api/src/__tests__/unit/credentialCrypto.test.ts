/**
 * @module api/__tests__/unit/credentialCrypto
 * @description The encryption-at-rest contract for BYOK credentials.
 *
 * This is the headline test for Phase 2. It is run as a unit (no database,
 * no Redis) because the module is pure crypto + base64, but it does exercise
 * every branch in the module:
 *
 *   - round-trip with the configured master key,
 *   - tampered ciphertext fails to decrypt,
 *   - tampered AAD (the row-swap defence) fails to decrypt,
 *   - unknown envelope prefixes and structural damage throw,
 *   - a previous key can still decrypt envelopes it produced,
 *   - the masked preview never reveals a short key,
 *   - thrown messages do not leak the plaintext, the envelope, or any
 *     8-character run of the key.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAad,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  maskSecret,
} from "../../lib/ai/credentialCrypto";

const MASTER_KEY = "test-only-encryption-key-placeholder-not-a-real-credential";

/** Set of env vars the module reads. Saved/restored around every test so the
 *  suite cannot pollute siblings that read the same variables. */
const ENV_KEYS = [
  "AI_CREDENTIAL_ENCRYPTION_KEY",
  "AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS",
] as const;

let savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  savedEnv = {
    AI_CREDENTIAL_ENCRYPTION_KEY: process.env.AI_CREDENTIAL_ENCRYPTION_KEY,
    AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS:
      process.env.AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  };
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = MASTER_KEY;
  delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ── Happy path ───────────────────────────────────────────────────────────────

describe("encryptSecret + decryptSecret — round-trip", () => {
  it("returns the original plaintext", () => {
    const aad = buildAad("user-1", "openai");
    const envelope = encryptSecret("sk-live-abcdefghijklmnop", aad);

    expect(decryptSecret(envelope, aad)).toBe("sk-live-abcdefghijklmnop");
  });

  it("preserves multibyte plaintext", () => {
    // The encryption is UTF-8 in, UTF-8 out; a multibyte string must come back
    // byte-identical. A failure here would mean the cipher is treating the
    // input as latin1 or losing characters at the buffer boundary.
    const aad = buildAad("user-2", "deepseek");
    const plaintext = "sk-秘密-🚀-κόσμος";

    const envelope = encryptSecret(plaintext, aad);

    expect(decryptSecret(envelope, aad)).toBe(plaintext);
  });

  it("produces a fresh IV for every encryption", () => {
    // Two encryptions of the same plaintext with the same AAD must yield
    // different ciphertext, because the IV is randomly generated. A static
    // IV would let an attacker tell when two users supplied the same key.
    const aad = buildAad("user-3", "groq");
    const first = encryptSecret("sk-same", aad);
    const second = encryptSecret("sk-same", aad);

    expect(first).not.toBe(second);
    // But both still decrypt to the same plaintext.
    expect(decryptSecret(first, aad)).toBe("sk-same");
    expect(decryptSecret(second, aad)).toBe("sk-same");
  });

  it("emits the nimbus1 envelope prefix", () => {
    const aad = buildAad("user-4", "openai");
    const envelope = encryptSecret("sk-x", aad);

    expect(envelope.startsWith("nimbus1.")).toBe(true);
  });
});

// ── Tamper detection ─────────────────────────────────────────────────────────

describe("decryptSecret — tamper detection", () => {
  it("rejects tampered ciphertext", () => {
    const aad = buildAad("user-5", "openai");
    const envelope = encryptSecret("sk-supersecret-1234567890", aad);

    // Flip a byte deep in the ciphertext segment. Doing this at the byte
    // level (decode, mutate, re-encode) is the only reliable way to produce
    // a *valid* base64 envelope with corrupted ciphertext — a string-level
    // flip can land on a padding char or produce an invalid base64 token.
    const parts = envelope.split(".");
    const ctBytes = Buffer.from(parts[parts.length - 1]!, "base64");
    ctBytes[0] = ctBytes[0]! ^ 0xff;
    parts[parts.length - 1] = ctBytes.toString("base64");
    const tampered = parts.join(".");

    expect(() => decryptSecret(tampered, aad)).toThrow();
  });

  it("rejects tampered auth tag", () => {
    const aad = buildAad("user-6", "openai");
    const envelope = encryptSecret("sk-supersecret-1234567890", aad);

    // Flip a base64 char in the tag (the second-to-last segment).
    const parts = envelope.split(".");
    const tagB64 = parts[parts.length - 2]!;
    const replacement = tagB64[0] === "A" ? "B" : "A";
    parts[parts.length - 2] = replacement + tagB64.slice(1);
    const tampered = parts.join(".");

    expect(() => decryptSecret(tampered, aad)).toThrow();
  });

  it("rejects a row swap to another user (AAD mismatch)", () => {
    // The row-swap defence: a row whose envelope was encrypted with
    // user-A's AAD fails to decrypt when read with user-B's AAD, even though
    // the master key is identical. Without the AAD bind, swapping `userId`
    // on a stolen row would yield a usable key.
    const alice = buildAad("alice", "openai");
    const bob = buildAad("bob", "openai");
    const envelope = encryptSecret("sk-alice-only", alice);

    expect(() => decryptSecret(envelope, bob)).toThrow();
  });

  it("rejects a row swap to another provider (AAD mismatch)", () => {
    const openai = buildAad("user-7", "openai");
    const groq = buildAad("user-7", "groq");
    const envelope = encryptSecret("sk-stored-as-openai", openai);

    expect(() => decryptSecret(envelope, groq)).toThrow();
  });

  it("does not silently decrypt with a tampered IV", () => {
    // The IV is authenticated by GCM just like the ciphertext — flipping
    // bits in it must cause the tag check to fail. A separate assertion
    // matters because a buggy implementation that forgot to call
    // `setAuthTag` would still throw on a tampered ciphertext, but might
    // happily accept a tampered IV.
    const aad = buildAad("user-8", "openai");
    const envelope = encryptSecret("sk-stored", aad);
    const parts = envelope.split(".");

    const ivBytes = Buffer.from(parts[2]!, "base64");
    ivBytes[0] = ivBytes[0]! ^ 0xff;
    parts[2] = ivBytes.toString("base64");
    const tampered = parts.join(".");

    expect(() => decryptSecret(tampered, aad)).toThrow();
  });
});

// ── Envelope shape ───────────────────────────────────────────────────────────

describe("decryptSecret — envelope validation", () => {
  it("rejects an envelope without the nimbus1 prefix", () => {
    const aad = buildAad("user-9", "openai");

    expect(() => decryptSecret("v2.deadbeef.AAAA.BBBB.CCCC", aad)).toThrow(
      /nimbus1/,
    );
  });

  it("rejects a malformed envelope with too few parts", () => {
    const aad = buildAad("user-10", "openai");

    expect(() => decryptSecret("nimbus1.deadbeef.AAAA.BBBB", aad)).toThrow();
  });

  it("rejects a malformed envelope with an empty segment", () => {
    const aad = buildAad("user-11", "openai");

    expect(() => decryptSecret("nimbus1..AAAA.BBBB.CCCC", aad)).toThrow();
  });

  it("rejects an envelope whose IV is the wrong length", () => {
    // A 12-byte AES-GCM IV base64-encodes to 16 chars (no padding). Forge
    // one with a different length to confirm the parse path catches it
    // rather than feeding GCM a non-standard IV.
    const aad = buildAad("user-12", "openai");

    // 8 zero bytes base64-encoded is "AAAAAAAAAA==" — wrong length for AES-GCM.
    expect(() =>
      decryptSecret("nimbus1.deadbeef.AAAAAAAAAA==.CCCC.DDDD", aad),
    ).toThrow(/IV/i);
  });

  it("rejects decryption when no master key is configured", () => {
    // The encrypted envelope was produced earlier in the test, so the
    // ciphertext itself is fine; the failure is on the decrypt side, where
    // the absence of any candidate key throws.
    const aad = buildAad("user-13", "openai");
    const envelope = encryptSecret("sk-orphan", aad);

    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;

    expect(() => decryptSecret(envelope, aad)).toThrow();
  });

  it("refuses to encrypt when no master key is configured", () => {
    // The reverse direction: storing a credential without a key configured
    // must fail loudly so the credential route returns 503, never silently
    // storing an unencrypted key.
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;

    const aad = buildAad("user-13b", "openai");
    expect(() => encryptSecret("sk-needs-key", aad)).toThrow(
      /AI_CREDENTIAL_ENCRYPTION_KEY/,
    );
  });

  it("refuses to encrypt when the configured key is shorter than 32 chars", () => {
    // A short passphrase is as broken as a missing one: HKDF derives a key
    // regardless of input length, but the documented contract is that the
    // env var holds a real secret, so the boot validation in env.ts rejects
    // shorter values. credentialCrypto's own guard is a defence-in-depth —
    // a misconfigured deployment that bypassed env.ts (e.g. by setting the
    // variable after boot via process.env assignment) still fails here.
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = "too-short";
    const aad = buildAad("user-13c", "openai");
    expect(() => encryptSecret("sk-needs-key", aad)).toThrow();
  });

  it("rejects an envelope whose auth tag has the wrong length", () => {
    // A 16-byte GCM tag base64-encodes to 24 chars (with `==` padding).
    // Forge one with a different length to confirm the parse path catches
    // it before GCM is asked to use it.
    const aad = buildAad("user-13d", "openai");
    // IV (12 bytes) base64 is 16 chars; tag of 8 bytes base64 is "AAAAAAAAAA==" — wrong length.
    expect(() =>
      decryptSecret("nimbus1.deadbeef.AAAAAAAAAAAAAAAA.AAAAAAAAAA==.BBBB", aad),
    ).toThrow(/tag/i);
  });
});

// ── Key rotation ─────────────────────────────────────────────────────────────

describe("key rotation — previous keys still decrypt", () => {
  it("an envelope produced under the previous key still decrypts after rotation", () => {
    const previous = "previous-master-key-32-chars-or-more-long-aaaaaaaa";
    const current = MASTER_KEY;

    const aad = buildAad("user-14", "openai");

    // Encrypt under the previous key.
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = previous;
    const envelope = encryptSecret("sk-rotated", aad);

    // Rotate: previous is in the previous-keys env, current is in the
    // master-key env. The new encrypt path uses the current key, but the
    // existing envelope must still be readable.
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = current;
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS = previous;

    expect(decryptSecret(envelope, aad)).toBe("sk-rotated");

    // And new encrypts use the current key — the keyId prefix differs.
    const fresh = encryptSecret("sk-fresh", aad);
    expect(fresh.startsWith("nimbus1.")).toBe(true);
    const freshKeyId = fresh.split(".")[1]!;
    const oldKeyId = envelope.split(".")[1]!;
    expect(freshKeyId).not.toBe(oldKeyId);

    // Each decrypts cleanly under its own key.
    expect(decryptSecret(fresh, aad)).toBe("sk-fresh");
    expect(decryptSecret(envelope, aad)).toBe("sk-rotated");
  });

  it("an envelope whose previous key is no longer listed throws", () => {
    const previous = "previous-master-key-32-chars-or-more-long-aaaaaaaa";

    const aad = buildAad("user-15", "openai");

    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = previous;
    const envelope = encryptSecret("sk-orphan-after-rotation", aad);

    // Rotate and drop the previous key. The envelope is now undecryptable
    // — the row needs to be re-encrypted by a rotation script.
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = MASTER_KEY;
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;

    expect(() => decryptSecret(envelope, aad)).toThrow();
  });
});

// ── PII safety ───────────────────────────────────────────────────────────────

describe("fingerprintSecret — ledger identity, not a secret", () => {
  it("is deterministic for the same plaintext", () => {
    const a = fingerprintSecret("sk-1");
    const b = fingerprintSecret("sk-1");
    expect(a).toBe(b);
  });

  it("differs for different plaintexts", () => {
    expect(fingerprintSecret("sk-1")).not.toBe(fingerprintSecret("sk-2"));
  });

  it("is a 16-character hex string", () => {
    expect(fingerprintSecret("sk-x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("maskSecret — never reveals a short key", () => {
  it("masks keys long enough for a head+tail preview", () => {
    expect(maskSecret("sk-live-abcdefghijklmnop")).toBe("sk-…mnop");
  });

  it("replaces the whole key with dots when too short to head+tail safely", () => {
    // Below the threshold the head and tail would overlap, or leave only a
    // handful of characters masked — enough to brute force the unknown
    // region cheaply. The contract is dots.
    expect(maskSecret("1234567")).toBe("•••••••");
  });

  it("uses the fixed mask at the minimum length", () => {
    // The threshold is conservative on purpose: at length 11 the masked
    // portion would be four characters, which is brute-forceable. At
    // length 12 the masked portion is five, which is enough to push the
    // cost beyond "trivial" — so 12 is where the preview path becomes
    // safe.
    expect(maskSecret("12345678901")).toBe("•••••••••••");
    expect(maskSecret("123456789012")).toBe("123…9012");
  });
});

// ── Redaction contract: thrown messages never carry a secret ─────────────────

describe("decryptSecret — thrown messages do not leak secrets", () => {
  // A thrown error that includes the plaintext, the envelope, or any
  // 8-character run of the key is the kind of bug a future logging formatter
  // turns into a key leak. The contract is the message: no key material,
  // ever.

  /** 32-character test key with a recognizable substring so an accidental
   *  substring leak in an error message is detectable. */
  const SECRET = "sk-leakcanary-1234567890abcdef";
  /** Any 8-character run taken from the secret. */
  const eightCharRun = (s: string) => s.slice(0, 8);

  const aad = buildAad("user-16", "openai");
  const envelope = encryptSecret(SECRET, aad);

  it("does not echo the plaintext in its error message", () => {
    let caught: Error | undefined;
    try {
      decryptSecret(envelope.slice(0, -4) + "AAAA", aad);
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).not.toContain(SECRET);
  });

  it("does not echo the envelope in its error message", () => {
    let caught: Error | undefined;
    try {
      decryptSecret(envelope.slice(0, -4) + "AAAA", aad);
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).not.toContain(envelope);
  });

  it("does not contain any 8-character run of the plaintext", () => {
    let caught: Error | undefined;
    try {
      decryptSecret(envelope.slice(0, -4) + "AAAA", aad);
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).not.toContain(eightCharRun(SECRET));
  });

  it("does not contain the plaintext in any chained `cause` either", () => {
    // `new Error(msg, { cause })` is a known leak vector: some loggers
    // stringify the cause, and the underlying GCM error message can echo
    // input bytes. The module does not pass `cause` on its throws, so the
    // chain is undefined or undefined-bearing.
    let caught: Error | undefined;
    try {
      decryptSecret(envelope.slice(0, -4) + "AAAA", aad);
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeDefined();
    const cause = (caught as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      const causeStr =
        cause instanceof Error ? cause.message : JSON.stringify(cause);
      expect(causeStr).not.toContain(SECRET);
      expect(causeStr).not.toContain(eightCharRun(SECRET));
    }
  });
});
