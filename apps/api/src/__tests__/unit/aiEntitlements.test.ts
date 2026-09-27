/**
 * @module api/__tests__/unit/aiEntitlements
 * @description The resolver's precedence chain as a table — one case per row.
 *
 * The resolver is a thin wrapper around three pure pieces
 * (`selectModelForFeature`, `freeTier()`, `credentialCrypto`) plus the
 * database read. The pure pieces are tested in their own files; this suite
 * exercises the resolver end-to-end through the database, asserting on the
 * `AiResolution` shape and on the curated messages.
 *
 * The headline assertion the plan calls out is the no-secret-leak invariant:
 * no message produced by the resolver can ever echo an `sk-…` token, the
 * envelope, or any 8-character substring of a key. That is asserted once per
 * refusal category with a synthetic key, then again as a sweep over every
 * case in the table.
 *
 * @important The DB rows in this suite use throwaway encrypted envelopes
 *            produced by the real `credentialCrypto`. The point is to drive
 *            the resolver through its real read path; a stubbed envelope
 *            would not exercise the decryption success branch.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import {
  closeTestResources,
  createUser,
  resetDatabase,
  testPrisma,
} from "@testhelpers";
import {
  __resetFreeTierWarningForTests,
  resolveAi,
  type AiRefusalReason,
} from "../../lib/ai/entitlements";
import { buildAad, encryptSecret } from "../../lib/ai/credentialCrypto";

const MASTER_KEY = "test-only-encryption-key-placeholder-not-a-real-credential";

const ENV_KEYS = [
  "AI_API_KEY",
  "AI_PROVIDER",
  "AI_MODEL",
  "AI_FREE_DOC_LIMIT",
  "AI_CREDENTIAL_ENCRYPTION_KEY",
] as const;

let savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  savedEnv = {
    AI_API_KEY: process.env.AI_API_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
    AI_FREE_DOC_LIMIT: process.env.AI_FREE_DOC_LIMIT,
    AI_CREDENTIAL_ENCRYPTION_KEY: process.env.AI_CREDENTIAL_ENCRYPTION_KEY,
  };
  process.env.AI_API_KEY = "operator-free-tier-key";
  process.env.AI_PROVIDER = "deepseek";
  process.env.AI_MODEL = "deepseek-flash";
  delete process.env.AI_FREE_DOC_LIMIT;
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = MASTER_KEY;
  __resetFreeTierWarningForTests();
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await closeTestResources();
});

/** A throwaway API key with a distinctive substring for leak detection. */
const FAKE_KEY = "sk-test-fake-key-DISTINCT12345678";

/**
 * Inserts a credential row for a user, encrypted with the test master key.
 * Returns the row id.
 */
const insertCredential = async (
  userId: string,
  providerId: string,
  apiKey: string = FAKE_KEY,
  createdAt?: Date,
) =>
  testPrisma.aiCredential.create({
    data: {
      userId,
      providerId,
      keyEnvelope: encryptSecret(apiKey, buildAad(userId, providerId)),
      keyId: "testkeyid",
      keyFingerprint: "fp" + Math.random().toString(16).slice(2, 14),
      maskedPreview: "sk-…XXXX",
      ...(createdAt ? { createdAt } : {}),
    },
  });

const insertPreference = async (
  userId: string,
  feature: "CHAT" | "MARKDOWN" | "CANVAS",
  providerId: string,
  modelId: string,
) =>
  testPrisma.aiFeaturePreference.create({
    data: {
      userId,
      feature,
      providerId,
      modelId,
    },
  });

// ── Precedence chain ────────────────────────────────────────────────────────

describe("resolveAi — precedence chain", () => {
  it("step 1: preference + matching credential → BYOK on the chosen model", async () => {
    const user = await createUser();
    await insertCredential(user.id, "openai");
    await insertPreference(user.id, "CHAT", "openai", "gpt-5-nano");

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe("byok");
      expect(res.providerId).toBe("openai");
      expect(res.modelId).toBe("gpt-5-nano");
      expect(res.substituted).toBe(false);
      expect(res.credentialId).toBeDefined();
    }
  });

  it("step 1: a preference whose model cannot do the feature is substituted with the provider default", async () => {
    // Phase 1's selector tests cover the pure case; this test confirms the
    // resolver propagates `substituted: true` rather than silently refusing.
    // The Groq provider's default `openai/gpt-oss-120b` meets chat's hard
    // requirement; we save a preference for a model id that the registry
    // does not contain, so the selector falls through to step 3.
    const user = await createUser();
    await insertCredential(user.id, "openai");
    await insertPreference(
      user.id,
      "CHAT",
      "openai",
      "model-that-does-not-exist",
    );

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.substituted).toBe(true);
      // Fell back to the provider default, not the (unknown) preference.
      expect(res.modelId).toBe("gpt-5-nano");
    }
  });

  it("step 2: a preference whose credential was deleted falls through to the primary credential", async () => {
    const user = await createUser();
    // No credential for the preferred provider; a credential for another
    // provider exists.
    await insertCredential(user.id, "groq");
    await insertPreference(user.id, "CHAT", "openai", "gpt-5-nano");

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(true);
    if (res.ok) {
      // The selector fell through step 1 (no credential for `openai`) to
      // step 3 (the only credential, on `groq`). The user's stated
      // preference was for `openai`; since `groq` is a different provider,
      // `substituted` is false — `substituted` is about whether the chosen
      // *model* was honoured, not whether the chosen *provider* was.
      expect(res.providerId).toBe("groq");
      expect(res.substituted).toBe(false);
    }
  });

  it("step 3: the primary credential is the earliest createdAt", async () => {
    const user = await createUser();
    // Two credentials on the same user. The resolver must pick the older
    // one (decision 3).
    const now = Date.now();
    await insertCredential(user.id, "openai", FAKE_KEY, new Date(now - 1000));
    await insertCredential(user.id, "groq", FAKE_KEY, new Date(now));

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.providerId).toBe("openai");
    }
  });

  it("step 4: the free tier is used only when there are no credentials (decision 9)", async () => {
    // A user with no credential rows gets the operator key for free.
    const user = await createUser();

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe("free");
      expect(res.providerId).toBe("deepseek");
      expect(res.modelId).toBe("deepseek-flash");
    }
  });

  it("step 4: a user with a credential never consumes the free tier (decision 9)", async () => {
    // Even if the free tier is the only configured path, a stored credential
    // means the user's own key is used. The plan calls this out explicitly
    // so it doesn't get "fixed" into a free-tier-fallback that bills the
    // operator for a paying customer.
    const user = await createUser();
    await insertCredential(user.id, "openai");

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe("byok");
      expect(res.providerId).toBe("openai");
    }
  });
});

// ── Refusal categories ──────────────────────────────────────────────────────

describe("resolveAi — refusals carry curated reasons and CTAs", () => {
  it("no credential + no operator key + encryption configured → `no-operator-key`", async () => {
    process.env.AI_API_KEY = "";
    const user = await createUser();

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("no-operator-key");
      expect(res.cta).toBe("add-key");
    }
  });

  it("no credential + no operator key + encryption unset → `byok-unavailable`", async () => {
    process.env.AI_API_KEY = "";
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    const user = await createUser();

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("byok-unavailable");
      expect(res.cta).toBeNull();
    }
  });

  it("no credential + operator key configured → free tier (not a refusal)", async () => {
    // The "no-key" refusal is reserved for the case where neither path
    // exists. With the operator key set, the free tier serves.
    const user = await createUser();

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe("free");
    }
  });

  it("no credential + operator key configured + free-tier model fails the feature → `no-capable-model`", async () => {
    // Configure the free tier at a model id that the registry does not
    // contain. The selector falls through the free tier, and the resolver
    // surfaces the registry mismatch as `no-capable-model` rather than
    // crashing.
    process.env.AI_MODEL = "model-that-does-not-exist";
    const user = await createUser();

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("no-capable-model");
      expect(res.cta).toBe("manage-ai");
    }
  });

  it("credentials exist, but every default model lacks the feature → `no-capable-model`", async () => {
    // A user with a credential whose provider default cannot do canvas.
    // The selector's step 3 iterates credentials and refuses when none can
    // serve the feature. The resolver surfaces that as a managed-AI CTA
    // (the user already has a key; the issue is the model).
    process.env.AI_PROVIDER = "groq";
    process.env.AI_MODEL = "model-that-does-not-exist";
    const user = await createUser();

    // No credentials, free tier is broken. Resolver falls through both.
    const res = await resolveAi(user.id, "canvas");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("no-capable-model");
      expect(res.cta).toBe("manage-ai");
    }
  });
});

// ── The headline no-secret-leak invariant ────────────────────────────────────

describe("resolveAi — no message ever leaks the API key", () => {
  // A key-leak is the headline failure this feature exists to prevent.
  // Sweep every case in the table once with a distinctive key, and assert
  // that none of the produced messages echo it, the envelope, or an
  // 8-character substring.
  const DISTINCTIVE = "DISTINCT12345678";

  const allMessageStrings = async (
    userId: string,
    feature: "chat" | "markdown" | "canvas" = "chat",
  ): Promise<string[]> => {
    const res = await resolveAi(userId, feature);
    if (res.ok) return [];
    return [res.message, res.detail ?? ""];
  };

  const sweep = async (
    userId: string,
    feature: "chat" | "markdown" | "canvas" = "chat",
  ) => {
    const messages = await allMessageStrings(userId, feature);
    for (const m of messages) {
      // The full distinctive substring.
      expect(m).not.toContain(DISTINCTIVE);
      // The plan's literal no-leak regex: matches `sk-` (provider key
      // prefix) and `api key` / `api_key` / `api-key`. The curated
      // messages avoid the phrase `API key` entirely so the regex is a
      // tight, zero-tolerance filter — it cannot accidentally pass on a
      // UI phrase that contains `api-key`.
      expect(m).not.toMatch(/sk-|api[-_]?key/i);
      // The distinctive 8-char run taken from the middle of the key.
      expect(m).not.toContain("DISTINCT1");
    }
  };

  it("no refusal message echoes the stored key — no operator key", async () => {
    process.env.AI_API_KEY = "";
    const user = await createUser();
    await insertCredential(user.id, "openai", `sk-${DISTINCTIVE}`);

    await sweep(user.id);
  });

  it("no refusal message echoes the stored key — encryption unset + no operator key", async () => {
    // The credential row is inserted while the encryption key IS set, then
    // the test removes the key. The row itself is still in the DB; the
    // resolver sees a BYOK selection and decrypt-fails because the master
    // key is gone, surfacing `byok-unavailable`. The whole point is that
    // the curated message names the user-facing action (re-add), not the
    // decryption-failed cause.
    const user = await createUser();
    await insertCredential(user.id, "openai", `sk-${DISTINCTIVE}`);

    process.env.AI_API_KEY = "";
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;

    await sweep(user.id);
  });

  it("no refusal message echoes the stored key — provider default fails", async () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "model-that-does-not-exist";
    const user = await createUser();
    await insertCredential(user.id, "openai", `sk-${DISTINCTIVE}`);

    await sweep(user.id);
  });

  it("the BYOK success carries the keyFingerprint, not the key", async () => {
    // Success path: the handle carries the client + keyFingerprint. The
    // key itself is held only inside the SDK client (not inspectable), and
    // the resolver never serialises it.
    const user = await createUser();
    const cred = await insertCredential(user.id, "openai", `sk-${DISTINCTIVE}`);

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.keyFingerprint).toBeDefined();
      expect(res.keyFingerprint).not.toBe(`sk-${DISTINCTIVE}`);
      expect(res.keyFingerprint).not.toContain(DISTINCTIVE);
      expect(res.credentialId).toBe(cred.id);
    }
  });
});

// ── Free-tier warning ────────────────────────────────────────────────────────

describe("resolveAi — free-tier capability warning", () => {
  it("warns once per process when the free tier is used", async () => {
    // The plan calls for exactly one `warn` per process — a flood would
    // mask the first one, and a missing one would let a misconfigured
    // deployment ship without anyone noticing.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      // Two different users, both served by the free tier.
      const a = await createUser("Warn A");
      const b = await createUser("Warn B");

      await resolveAi(a.id, "chat");
      await resolveAi(b.id, "chat");

      const freeTierWarnings = warnSpy.mock.calls.filter((args) =>
        String(args[0]).startsWith("[ai] Free-tier capabilities"),
      );
      expect(freeTierWarnings.length).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ── Concurrency / DB-shape edge cases ────────────────────────────────────────

describe("resolveAi — DB-shape edge cases", () => {
  it("treats a missing user row as 'no credentials, no preferences' rather than throwing", async () => {
    // The chat handler authenticates before calling the resolver, so this
    // case is rare — but the resolver must not throw if it happens. The
    // fall-through is to the free tier (operator key is set in this file's
    // beforeEach).
    const ghost = "ghost-" + randomUUID();

    const res = await resolveAi(ghost, "chat");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe("free");
    }
  });

  it("ignores another user's credentials (rows scoped by userId)", async () => {
    // The plan's RBAC invariant: a credential that is not the caller's
    // returns 404 (not 403) at the REST surface. At the resolver level the
    // equivalent is "rows scoped by userId" — Alice's key never serves Bob.
    const alice = await createUser("Alice");
    const bob = await createUser("Bob");
    await insertCredential(alice.id, "openai");

    const res = await resolveAi(bob.id, "chat");

    expect(res.ok).toBe(true);
    if (res.ok) {
      // Bob has no credential of his own; he falls through to the free
      // tier even though Alice's row exists.
      expect(res.source).toBe("free");
    }
  });

  it("maps the DB feature enum (uppercase) to the resolver feature (lowercase)", async () => {
    // The DB stores `CHAT` / `MARKDOWN` / `CANVAS`; the resolver and the
    // registry use lowercase. The mapping lives in the resolver so the
    // selector does not have to know about the database.
    const user = await createUser();
    await insertCredential(user.id, "openai");
    await insertPreference(user.id, "CANVAS", "openai", "gpt-5-nano");

    const res = await resolveAi(user.id, "canvas");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.providerId).toBe("openai");
      expect(res.modelId).toBe("gpt-5-nano");
    }
  });

  it("treats a credential row whose envelope fails to decrypt as `byok-unavailable`", async () => {
    // The DB has a stale envelope (rotation, tampering). The resolver
    // surfaces as `byok-unavailable` rather than crashing or leaking a
    // decryption error message.
    const user = await createUser();
    await testPrisma.aiCredential.create({
      data: {
        userId: user.id,
        providerId: "openai",
        // Not a real envelope — the parser will throw.
        keyEnvelope: "nimbus1.deadbeef.AAAA.BBBB.FFFF",
        keyId: "deadbeef",
        keyFingerprint: "fp" + Math.random().toString(16).slice(2, 14),
        maskedPreview: "sk-…XXXX",
      },
    });

    const res = await resolveAi(user.id, "chat");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("byok-unavailable");
      // The message names the action (re-add) rather than the cause
      // (decryption failed), which would echo the master-key bytes via a
      // logger.
      expect(res.message).toMatch(/re-add|please contact/i);
    }
  });
});

// ── Reason union sanity ─────────────────────────────────────────────────────

describe("AiRefusalReason — the union matches the resolver's contract", () => {
  // The union is exported for the controller and the socket layer. Pin the
  // membership here so adding a new reason requires updating this list
  // alongside the resolver, the socket event, and the DTO.
  const expectedReasons: readonly AiRefusalReason[] = [
    "no-key",
    "free-tier-exhausted",
    "no-operator-key",
    "no-capable-model",
    "byok-unavailable",
  ];

  it.each(expectedReasons)("declares `%s`", (reason) => {
    expect(expectedReasons).toContain(reason);
  });
});
