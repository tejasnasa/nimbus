/**
 * @module api/lib/ai/credentialCrypto
 * @description Encryption-at-rest for user-supplied AI provider API keys.
 *
 * A user that pastes their own key into Nimbus trusts us with a credential that
 * can spend their money, so the at-rest representation is encrypted with
 * AES-256-GCM rather than stored plaintext. The envelope is
 * `nimbus1.<keyId>.<ivB64>.<tagB64>.<ctB64>`, one row per (user, provider).
 *
 * @important These must never happen:
 *   - log the plaintext, the envelope, or the derived 32-byte master key;
 *   - put plaintext or key bytes in an error message — including inside
 *     `new Error(msg, { cause })`, because some loggers stringify the cause;
 *   - accept an envelope without the `nimbus1.` prefix;
 *   - invent a default or "no encryption" key when the env var is missing.
 *     The variable is required at boot (`lib/env.ts`), so there is no
 *     unconfigured runtime state to degrade into;
 *   - export anything that returns a plaintext key to an HTTP layer. The
 *     DTO type has no field for it, so a leak would be a type error;
 *   - use a non-AEAD mode or a static IV.
 *
 * @important The threat model is honest. The process holds the master key in
 *   its environment, so anyone with read access to the running container's
 *   env, a memory dump, or a DB dump *plus* the master key can decrypt every
 *   stored key. What this buys is blast-radius reduction for the realistic
 *   incident — a leaked backup, a read-only SQL injection, a `SELECT *` in a
 *   support tool, a stray log line. It is **not** a vault: no per-user
 *   encryption, no HSM, no re-authentication before use. UI copy must not
 *   imply otherwise.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  createHash,
} from "node:crypto";

/** Envelope version. The format is independent of the key, so rotation needs
 *  no version bookkeeping: decrypt with the current key, and if `keyId` does
 *  not match, try each key in `AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`. */
const ENVELOPE_PREFIX = "nimbus1.";

/** The column name used for both the master env var and the previous-keys env
 *  var. Kept here so a typo in the caller fails the typecheck rather than
 *  silently reading the wrong variable. */
const MASTER_KEY_ENV = "AI_CREDENTIAL_ENCRYPTION_KEY";
const PREVIOUS_KEYS_ENV = "AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS";

/** HKDF salt — domain-separated so a different subsystem cannot accidentally
 *  derive the same bytes from the same input. */
const HKDF_SALT = Buffer.from("nimbus/ai-credential-encryption/v1", "utf8");

/** HKDF info string — names the use so a future reuse with a different
 *  purpose is a deliberate change rather than a coincidence. */
const HKDF_INFO = Buffer.from("ai-credential:v1", "utf8");

/** The AAD prefix used in GCM auth. The full AAD is
 *  `ai-credential:v1:<userId>:<providerId>`. A row swapped to another user
 *  or provider therefore fails to decrypt rather than yielding a usable
 *  key — closing the row-swap attack an unbound ciphertext allows. */
const AAD_PREFIX = "ai-credential:v1:";

/** AAD separator. The userId / providerId cannot themselves contain `:` in
 *  this codebase (cuid and an enum), but the separator is fixed here so the
 *  format cannot be subverted by an unanticipated input shape. */
const AAD_SEPARATOR = ":";

/** AES key length in bytes. */
const KEY_LENGTH = 32;

/** AES-GCM IV length in bytes. 96-bit IVs are the GCM-recommended length
 *  (other lengths run the IV through a ghash that is not constant-time). */
const IV_LENGTH = 12;

/** GCM auth tag length in bytes. */
const TAG_LENGTH = 16;

/** Length, in characters, of the key-id fingerprint stored alongside the
 *  ciphertext. Two hex bytes = 16 bits; collisions are intentional — the
 *  keyId is a hint, not a primary key. */
const KEY_ID_HEX_LENGTH = 8;

/** Length, in characters, of the per-key fingerprint used for ledger identity.
 *  Eight hex bytes = 32 bits; the fingerprint is not a secret and is never
 *  returned over HTTP. */
const FINGERPRINT_HEX_LENGTH = 16;

/** Minimum number of plaintext characters required to show a meaningful
 *  preview. Below this we just show a fixed placeholder rather than reveal
 *  the entire key. The threshold is conservative on purpose: at length 12
 *  the masked portion is five characters, which is enough to make brute
 *  forcing the unknown region expensive; at length 11 it is four, which
 *  is uncomfortable. */
const PREVIEW_MIN_LENGTH = 12;

/** How many characters of the prefix are visible in the masked preview. */
const PREVIEW_HEAD_LENGTH = 3;

/** How many characters of the suffix are visible in the masked preview. */
const PREVIEW_TAIL_LENGTH = 4;

/** AAD builder. Kept exported so callers (and tests) can derive the same AAD
 *  the encrypt path used, which is exactly what the decrypt path requires. */
export function buildAad(userId: string, providerId: string): Buffer {
  return Buffer.from(AAD_PREFIX + userId + AAD_SEPARATOR + providerId, "utf8");
}

/**
 * Reads the master key.
 *
 * `lib/env.ts` declares `AI_CREDENTIAL_ENCRYPTION_KEY` as required, so a
 * process that booted always has one. The guard here is a programmer-error
 * net for code that reads `process.env` directly (tests, scripts) rather than
 * a supported runtime state — there is no degraded "BYOK off" mode.
 */
function requireMasterKey(): Buffer {
  const raw = process.env[MASTER_KEY_ENV];
  if (!raw || raw.length < 32) {
    throw new Error(
      `${MASTER_KEY_ENV} is unset or shorter than 32 chars. It is required (see lib/env.ts).`,
    );
  }
  return deriveKey(raw);
}

/** Derives a 32-byte AES key from the configured passphrase via HKDF-SHA256.
 *
 *  Boot validation is `z.string().min(32)` in `lib/env.ts` rather than
 *  "base64 decoding to exactly 32 bytes", which accepts an
 *  `openssl rand -base64 32` value *and* a long passphrase, rejects short
 *  values loudly, and avoids an "invalid base64" failure mode.
 */
function deriveKey(passphrase: string): Buffer {
  const derived = hkdfSync(
    "sha256",
    Buffer.from(passphrase, "utf8"),
    HKDF_SALT,
    HKDF_INFO,
    KEY_LENGTH,
  );
  return Buffer.from(derived);
}

/** `sha256(derivedKey).slice(0,8)` — a stable hint of which master key
 *  encrypted this row. Same input produces the same digest, so a rotation
 *  script can select rows cheaply. */
function keyIdFor(key: Buffer): string {
  return createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, KEY_ID_HEX_LENGTH);
}

/** `sha256(apiKey).slice(0,16)` — ledger identity for the plaintext. Used by
 *  callers to dedupe at-rest entries without ever seeing the secret. Never
 *  returned over HTTP. */
export function fingerprintSecret(plaintext: string): string {
  return createHash("sha256")
    .update(plaintext, "utf8")
    .digest("hex")
    .slice(0, FINGERPRINT_HEX_LENGTH);
}

/** The masked preview shown in the UI. Format: `sk-…4f2a` — head, three
 *  dots, tail. The mask is not a security boundary (it is in the database in
 *  plaintext), but it prevents shoulder-surfing a screenshot of the panel.
 *
 *  When the key is too short to head+tail without revealing everything, the
 *  whole key is replaced with the same number of dots so nothing leaks.
 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length < PREVIEW_MIN_LENGTH) {
    return "•".repeat(plaintext.length);
  }
  const head = plaintext.slice(0, PREVIEW_HEAD_LENGTH);
  const tail = plaintext.slice(-PREVIEW_TAIL_LENGTH);
  return `${head}…${tail}`;
}

/**
 * Encrypts a plaintext API key for storage.
 *
 * @param plaintext - The user's API key. Never logged.
 * @param aad - The bind context (`userId:providerId`). A row swapped to a
 *              different user or provider fails to decrypt because the AAD
 *              check fails.
 * @returns The envelope `nimbus1.<keyId>.<ivB64>.<tagB64>.<ctB64>`.
 * @throws When the master key is unset or shorter than 32 chars.
 */
export function encryptSecret(plaintext: string, aad: Buffer): string {
  const key = requireMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_LENGTH,
  });
  const ptLen = Buffer.byteLength(plaintext, "utf8");
  cipher.setAAD(aad, { plaintextLength: ptLen });
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const keyId = keyIdFor(key);
  return (
    ENVELOPE_PREFIX +
    keyId +
    "." +
    iv.toString("base64") +
    "." +
    tag.toString("base64") +
    "." +
    ct.toString("base64")
  );
}

interface ParsedEnvelope {
  keyId: string;
  iv: Buffer;
  tag: Buffer;
  ct: Buffer;
}

/** Parses an envelope string. Throws on any structural problem rather than
 *  yielding a half-decrypted value. */
function parseEnvelope(envelope: string): ParsedEnvelope {
  if (!envelope.startsWith(ENVELOPE_PREFIX)) {
    throw new Error("Envelope is not in the nimbus1 format.");
  }
  const body = envelope.slice(ENVELOPE_PREFIX.length);
  const parts = body.split(".");
  if (parts.length !== 4) {
    throw new Error("Envelope is malformed.");
  }
  const [keyId, ivB64, tagB64, ctB64] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (!keyId || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Envelope is missing a field.");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  if (iv.length !== IV_LENGTH) {
    throw new Error("Envelope IV has the wrong length.");
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error("Envelope auth tag has the wrong length.");
  }
  return { keyId, iv, tag, ct };
}

/** The candidate keys to try, in order: current first, then each comma-
 *  separated previous. Each derived only on demand so a process that never
 *  decrypts never has them in memory. */
function candidateKeys(): Buffer[] {
  const current = process.env[MASTER_KEY_ENV];
  const keys: { id: string; key: Buffer }[] = [];
  if (current && current.length >= 32) {
    const derived = deriveKey(current);
    keys.push({ id: keyIdFor(derived), key: derived });
  }
  const previous = process.env[PREVIOUS_KEYS_ENV];
  if (previous) {
    for (const raw of previous.split(",")) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.length < 32) continue;
      const derived = deriveKey(trimmed);
      keys.push({ id: keyIdFor(derived), key: derived });
    }
  }
  // Keys are tried in declared order — current first, then each previous.
  // There is nothing to gain by matching `keyId` first: GCM's failure mode is
  // a throw (auth-tag mismatch), so a wrong key and a tampered envelope are
  // indistinguishable from the outside.
  return keys.map((entry) => entry.key);
}

/**
 * Decrypts an envelope back to a plaintext API key.
 *
 * @param envelope - The stored ciphertext envelope.
 * @param aad - The bind context. MUST equal the AAD used to encrypt, or the
 *              GCM tag check fails. The caller is responsible for passing the
 *              same `userId:providerId` that was used at save time.
 * @returns The plaintext API key.
 * @throws When the envelope is malformed, the master key is unset, or any
 *         key fails the GCM tag check (tampering, wrong key, wrong AAD).
 */
export function decryptSecret(envelope: string, aad: Buffer): string {
  const parsed = parseEnvelope(envelope);
  const keys = candidateKeys();
  if (keys.length === 0) {
    throw new Error(
      "No encryption key is configured; cannot decrypt stored credential.",
    );
  }
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, parsed.iv, {
        authTagLength: TAG_LENGTH,
      });
      decipher.setAuthTag(parsed.tag);
      decipher.setAAD(aad, { plaintextLength: parsed.ct.length });
      const pt = Buffer.concat([decipher.update(parsed.ct), decipher.final()]);
      return pt.toString("utf8");
    } catch {
      // Try the next candidate key. The failure is the same shape from every
      // key — GCM's tag check throws — so there is nothing useful to log
      // here without risking a leak of the tag bytes via a formatter.
    }
  }
  // All candidate keys failed: the envelope is not decryptable with anything
  // we hold. The thrown error from GCM tag failures is intentionally not a
  // richer message: it is enough to know the envelope is not decryptable,
  // and a longer message risks including the tag bytes via a logging
  // formatter.
  throw new Error("Stored credential could not be decrypted.");
}
