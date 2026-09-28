/**
 * @module api/__tests__/integration/http/ai
 * @description BYOK REST surface: status, credential CRUD, and per-feature
 * preferences.
 *
 * The headline assertions the plan calls out:
 *
 *   - **No secret leaks.** The list endpoint returns `maskedPreview` only,
 *     never the key, the envelope, or the key id. The DB row is checked
 *     directly to confirm what was stored is the encrypted envelope, not the
 *     plaintext.
 *   - **A failed probe stores nothing.** The `probeApiKey` mock is the seam
 *     that lets the test simulate `AuthenticationError` / model-not-found /
 *     connection failure without a real provider. The row count after a
 *     refused probe is the assertion that catches a half-saved credential.
 *   - **Cross-user 404, not 403.** A different user asking for someone
 *     else's row gets 404 — same convention as `getWorkspaceBySlugId` for
 *     non-members.
 *   - **Preference validation.** An unknown model, a model that lacks the
 *     feature's hard requirements, or a provider the user has no credential
 *     for all yield 422 — never a 500, never a silent substitution.
 *
 * The probe is mocked at the module boundary (`vi.mock("../../../lib/ai/probe")`)
 * so every credential-save test runs against a deterministic, fast response.
 * The probe itself is unit-tested elsewhere; this suite asserts the
 * orchestration (probe-then-upsert, error → 400, success → 200/201).
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../../../app";
import {
  as,
  closeTestResources,
  createUser,
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";

// Mock the probe module so the tests do not hit a real provider. Every
// credential-save test asserts the orchestration (success vs. failure path,
// status code, no row written on failure), not the probe's own behaviour.
vi.mock("../../../lib/ai/probe", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/ai/probe")>(
    "../../../lib/ai/probe",
  );
  return {
    ...actual,
    probeApiKey: vi.fn(async () => ({ ok: true as const })),
  };
});

import * as probeModule from "../../../lib/ai/probe";

const ENV_KEYS = [
  "AI_API_KEY",
  "AI_PROVIDER",
  "AI_MODEL",
  "AI_FREE_DOC_LIMIT",
  "AI_CREDENTIAL_ENCRYPTION_KEY",
] as const;

const MASTER_KEY = "test-only-encryption-key-placeholder-not-a-real-credential";
let savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

const app = createApp();

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
  // Default the probe mock back to success between tests.
  vi.mocked(probeModule.probeApiKey).mockResolvedValue({ ok: true });
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(closeTestResources);

const FAKE_KEY = "sk-test-fake-key-DISTINCT12345678";

describe("http: ai — status", () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await mintUser(app);
  });

  it("reports byokAvailable=true and a free-tier-quota payload", async () => {
    const res = await as(app, user).get("/api/ai/status");

    expect(res.status).toBe(200);
    expect(res.body.responseObject.byokAvailable).toBe(true);
    expect(res.body.responseObject.chat.enabled).toBe(true);
    expect(res.body.responseObject.documents.markdown.enabled).toBe(true);
    expect(res.body.responseObject.documents.canvas.enabled).toBe(true);
    expect(res.body.responseObject.documents.freeLimit).toBe(5);
    expect(res.body.responseObject.documents.freeRemaining).toBe(5);
    expect(res.body.responseObject.documents.freeTierState).toBe("available");
    expect(res.body.responseObject.credentials).toEqual([]);
    expect(res.body.responseObject.preferences.chat).toBeNull();
    expect(res.body.responseObject.preferences.markdown).toBeNull();
    expect(res.body.responseObject.preferences.canvas).toBeNull();
  });

  it("reports byokAvailable=false and free-tier-unconfigured when encryption is unset", async () => {
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.AI_API_KEY;

    const res = await as(app, user).get("/api/ai/status");

    expect(res.status).toBe(200);
    expect(res.body.responseObject.byokAvailable).toBe(false);
    expect(res.body.responseObject.chat.enabled).toBe(false);
    expect(res.body.responseObject.documents.markdown.enabled).toBe(false);
    expect(res.body.responseObject.documents.canvas.enabled).toBe(false);
    expect(res.body.responseObject.documents.freeTierState).toBe(
      "unconfigured",
    );
  });

  it("reports freeTierState=exhausted once the quota counter hits the limit", async () => {
    await testPrisma.user.update({
      where: { id: user.id },
      data: { freeDocGenerationsUsed: 5 },
    });

    const res = await as(app, user).get("/api/ai/status");

    expect(res.status).toBe(200);
    expect(res.body.responseObject.documents.freeTierState).toBe("exhausted");
    expect(res.body.responseObject.documents.freeRemaining).toBe(0);
    expect(res.body.responseObject.chat.enabled).toBe(true);
    expect(res.body.responseObject.documents.markdown.enabled).toBe(false);
    expect(res.body.responseObject.documents.canvas.enabled).toBe(false);
  });

  it("reports byokAvailable=true and free-tier-unconfigured when only the encryption key is set", async () => {
    // No AI_API_KEY but encryption is configured — the user is BYOK-only.
    delete process.env.AI_API_KEY;

    const res = await as(app, user).get("/api/ai/status");

    expect(res.status).toBe(200);
    expect(res.body.responseObject.byokAvailable).toBe(true);
    expect(res.body.responseObject.chat.enabled).toBe(false);
    expect(res.body.responseObject.documents.markdown.enabled).toBe(false);
    expect(res.body.responseObject.documents.canvas.enabled).toBe(false);
    expect(res.body.responseObject.documents.freeTierState).toBe(
      "unconfigured",
    );
  });

  it("always requires authentication", async () => {
    const { default: request } = await import("supertest");
    const res = await request(app).get("/api/ai/status");

    expect(res.status).toBe(401);
  });
});

describe("http: ai — credentials", () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await mintUser(app);
  });

  it("round-trips: create → list shows maskedPreview, no key, no envelope", async () => {
    const create = await as(app, user)
      .post("/api/ai/credentials")
      .send({ providerId: "openai", apiKey: FAKE_KEY });

    expect(create.status).toBe(201);
    const created = create.body.responseObject;
    expect(created.providerId).toBe("openai");
    expect(created.maskedPreview).toBe("sk-…5678");
    expect(created.validatedAt).toBeTruthy();
    expect(created.lastUsedAt).toBeNull();

    const list = await as(app, user).get("/api/ai/credentials");
    expect(list.status).toBe(200);
    expect(list.body.responseObject).toHaveLength(1);
    expect(list.body.responseObject[0]).toMatchObject({
      providerId: "openai",
      maskedPreview: "sk-…5678",
    });

    // The DTO MUST NOT carry the plaintext, the envelope, or the key id.
    const responseJson = JSON.stringify(list.body);
    expect(responseJson).not.toContain(FAKE_KEY);
    expect(responseJson).not.toContain("DISTINCT12345678");
    expect(responseJson).not.toMatch(/nimbus1\./);
    expect(responseJson).not.toMatch(/keyEnvelope/);
    expect(responseJson).not.toMatch(/keyFingerprint/);

    // The DB stores the envelope (ciphertext), not the plaintext.
    const stored = await testPrisma.aiCredential.findUnique({
      where: { userId_providerId: { userId: user.id, providerId: "openai" } },
    });
    expect(stored).not.toBeNull();
    expect(stored?.keyEnvelope.startsWith("nimbus1.")).toBe(true);
    expect(stored?.keyEnvelope).not.toContain(FAKE_KEY);
  });

  it("returns 200 (not 201) when re-saving for the same provider replaces the row", async () => {
    await as(app, user)
      .post("/api/ai/credentials")
      .send({ providerId: "openai", apiKey: FAKE_KEY });

    const replace = await as(app, user)
      .post("/api/ai/credentials")
      .send({ providerId: "openai", apiKey: "sk-replacement-key-9876" });

    expect(replace.status).toBe(200);
    expect(replace.body.message).toMatch(/updated/i);

    const list = await as(app, user).get("/api/ai/credentials");
    expect(list.body.responseObject).toHaveLength(1);
    expect(list.body.responseObject[0].maskedPreview).toBe("sk-…9876");

    const stored = await testPrisma.aiCredential.findMany({
      where: { userId: user.id, providerId: "openai" },
    });
    expect(stored).toHaveLength(1);
  });

  it("stores nothing when the probe fails — the headline assertion of this phase", async () => {
    vi.mocked(probeModule.probeApiKey).mockResolvedValueOnce({
      ok: false,
      reason: "incorrect-key",
      message: "Incorrect API key.",
    });

    const res = await as(app, user)
      .post("/api/ai/credentials")
      .send({ providerId: "openai", apiKey: FAKE_KEY });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Incorrect API key.");

    // The credentials table is untouched.
    const count = await testPrisma.aiCredential.count({
      where: { userId: user.id },
    });
    expect(count).toBe(0);

    const list = await as(app, user).get("/api/ai/credentials");
    expect(list.body.responseObject).toEqual([]);
  });

  it("maps each probe error class to the right user-visible message", async () => {
    const cases: Array<{
      reason: probeModule.ProbeRefusalReason;
      expectedMessage: RegExp;
    }> = [
      { reason: "incorrect-key", expectedMessage: /incorrect api key/i },
      {
        reason: "model-not-found",
        expectedMessage: /isn't available on/i,
      },
      { reason: "unreachable", expectedMessage: /could not reach/i },
      {
        reason: "unknown-error",
        expectedMessage: /could not validate the request/i,
      },
    ];

    for (const { reason, expectedMessage } of cases) {
      vi.mocked(probeModule.probeApiKey).mockResolvedValueOnce({
        ok: false,
        reason,
        message: provisionalMessage(reason),
      });

      const res = await as(app, user)
        .post("/api/ai/credentials")
        .send({
          providerId: "openai",
          apiKey: `${FAKE_KEY}-${reason}`,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(expectedMessage);
    }

    // Nothing was persisted across any of the four failed probes.
    const count = await testPrisma.aiCredential.count({
      where: { userId: user.id },
    });
    expect(count).toBe(0);
  });

  it("rejects an unknown providerId at the edge with 400", async () => {
    const res = await as(app, user)
      .post("/api/ai/credentials")
      .send({ providerId: "not-a-real-provider", apiKey: FAKE_KEY });

    expect(res.status).toBe(400);
    expect(
      res.body.responseObject.properties.providerId.errors.length,
    ).toBeGreaterThan(0);
  });

  it("rejects an empty API key at the edge with 400", async () => {
    const res = await as(app, user)
      .post("/api/ai/credentials")
      .send({ providerId: "openai", apiKey: "" });

    expect(res.status).toBe(400);
  });

  it("returns 503 when the encryption key is unset", async () => {
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;

    const res = await as(app, user)
      .post("/api/ai/credentials")
      .send({ providerId: "openai", apiKey: FAKE_KEY });

    expect(res.status).toBe(503);
  });

  it("lists an empty array (not a 503) when encryption is unset", async () => {
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;

    const res = await as(app, user).get("/api/ai/credentials");

    expect(res.status).toBe(200);
    expect(res.body.responseObject).toEqual([]);
  });

  describe("DELETE /api/ai/credentials/:providerId", () => {
    it("removes the row and reports how many preferences were dropped", async () => {
      await as(app, user)
        .post("/api/ai/credentials")
        .send({ providerId: "openai", apiKey: FAKE_KEY });
      await as(app, user)
        .put("/api/ai/preferences")
        .send({ feature: "chat", providerId: "openai", modelId: "gpt-5-nano" });
      await as(app, user).put("/api/ai/preferences").send({
        feature: "markdown",
        providerId: "openai",
        modelId: "gpt-5-nano",
      });

      const res = await as(app, user).delete("/api/ai/credentials/openai");

      expect(res.status).toBe(200);
      expect(res.body.responseObject.clearedPreferences).toBe(2);

      const credCount = await testPrisma.aiCredential.count({
        where: { userId: user.id, providerId: "openai" },
      });
      expect(credCount).toBe(0);

      const prefCount = await testPrisma.aiFeaturePreference.count({
        where: { userId: user.id, providerId: "openai" },
      });
      expect(prefCount).toBe(0);
    });

    it("removes the row but reports clearedPreferences=0 when no preferences pointed at the provider", async () => {
      await as(app, user)
        .post("/api/ai/credentials")
        .send({ providerId: "openai", apiKey: FAKE_KEY });

      const res = await as(app, user).delete("/api/ai/credentials/openai");

      expect(res.status).toBe(200);
      expect(res.body.responseObject.clearedPreferences).toBe(0);
    });

    it("returns 404 when the credential does not exist", async () => {
      const res = await as(app, user).delete("/api/ai/credentials/openai");

      expect(res.status).toBe(404);
    });
  });
});

describe("http: ai — preferences", () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await mintUser(app);
    await as(app, user)
      .post("/api/ai/credentials")
      .send({ providerId: "openai", apiKey: FAKE_KEY });
  });

  it("round-trips: save → list returns the saved entry", async () => {
    const save = await as(app, user).put("/api/ai/preferences").send({
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
    });

    expect(save.status).toBe(200);
    expect(save.body.responseObject).toMatchObject({
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
    });

    const list = await as(app, user).get("/api/ai/preferences");
    expect(list.status).toBe(200);
    expect(list.body.responseObject.chat).toMatchObject({
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
    });
    expect(list.body.responseObject.markdown).toBeNull();
    expect(list.body.responseObject.canvas).toBeNull();
  });

  it("returns 422 for a capability mismatch (stubbed via meetsRequirements)", async () => {
    // The current registry has no model that fails `meetsRequirements` for
    // any feature (every registered model has `tools`, `streaming`, and
    // `jsonMode`), so the production branch is unreachable from HTTP. To
    // still pin the controller's capability-mismatch 422, this case
    // monkey-patches the validator for the duration of the request.
    // `packages/utils`'s `ai.test.ts` exercises the same predicate
    // combinatorially with synthetic models; this test confirms the
    // controller wires the predicate through.
    const typesModule = await import("@nimbus/types");
    const meetsSpy = vi
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(typesModule as any, "meetsRequirements")
      .mockReturnValue(false);

    try {
      const res = await as(app, user).put("/api/ai/preferences").send({
        feature: "canvas",
        providerId: "openai",
        modelId: "gpt-5-nano",
      });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/does not support canvas/i);
    } finally {
      meetsSpy.mockRestore();
    }
  });

  it("returns 422 for an unknown model", async () => {
    const res = await as(app, user).put("/api/ai/preferences").send({
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-nonexistent",
    });

    expect(res.status).toBe(422);
  });

  it("returns 422 when the user has no credential for the chosen provider", async () => {
    // User has only openai saved; deepseek would silently fall through to
    // openai at call time, which is the substitution this endpoint exists
    // to prevent.
    const res = await as(app, user).put("/api/ai/preferences").send({
      feature: "chat",
      providerId: "deepseek",
      modelId: "deepseek-flash",
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/no credential saved/i);
  });

  it("returns 400 for an unknown providerId at the edge", async () => {
    const res = await as(app, user).put("/api/ai/preferences").send({
      feature: "chat",
      providerId: "not-a-provider",
      modelId: "gpt-5-nano",
    });

    expect(res.status).toBe(400);
  });

  it("rejects an unknown feature value with 400 at the edge", async () => {
    const res = await as(app, user).put("/api/ai/preferences").send({
      feature: "weird-feature",
      providerId: "openai",
      modelId: "gpt-5-nano",
    });

    expect(res.status).toBe(400);
  });

  it("updates an existing preference in place (no duplicate row)", async () => {
    await as(app, user).put("/api/ai/preferences").send({
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
    });
    await as(app, user).put("/api/ai/preferences").send({
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
    });

    const list = await as(app, user).get("/api/ai/preferences");
    expect(list.body.responseObject.chat).toMatchObject({
      modelId: "gpt-5-nano",
    });

    const count = await testPrisma.aiFeaturePreference.count({
      where: { userId: user.id, feature: "CHAT" },
    });
    expect(count).toBe(1);
  });
});

describe("http: ai — auth boundary", () => {
  it("rejects anonymous callers on every AI route with 401", async () => {
    const { default: request } = await import("supertest");

    const responses = await Promise.all([
      request(app).get("/api/ai/status"),
      request(app).get("/api/ai/credentials"),
      request(app)
        .post("/api/ai/credentials")
        .send({ providerId: "openai", apiKey: "sk-test" }),
      request(app).delete("/api/ai/credentials/openai"),
      request(app).get("/api/ai/preferences"),
      request(app).put("/api/ai/preferences").send({
        feature: "chat",
        providerId: "openai",
        modelId: "gpt-5-nano",
      }),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ success: false, statusCode: 401 });
    }
  });

  it("never leaks the operator's AI_API_KEY or the encryption key on any response", async () => {
    const user = await mintUser(app);
    await as(app, user)
      .post("/api/ai/credentials")
      .send({ providerId: "openai", apiKey: FAKE_KEY });
    await as(app, user).put("/api/ai/preferences").send({
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
    });

    const list = await as(app, user).get("/api/ai/credentials");
    const prefs = await as(app, user).get("/api/ai/preferences");
    const status = await as(app, user).get("/api/ai/status");

    for (const [name, res] of [
      ["list", list],
      ["preferences", prefs],
      ["status", status],
    ] as const) {
      const body = JSON.stringify(res.body);
      expect(body, `${name} response leaked the operator key`).not.toContain(
        "operator-free-tier-key",
      );
      expect(body, `${name} response leaked the encryption key`).not.toContain(
        MASTER_KEY,
      );
      expect(
        body,
        `${name} response leaked the user-provided key`,
      ).not.toContain(FAKE_KEY);
      expect(
        body,
        `${name} response leaked a distinctive substring of the user-provided key`,
      ).not.toContain("DISTINCT12345678");
    }
  });
});

/**
 * Returns the message the controller would produce for a given probe
 * refusal reason. The actual messages come from `probe.ts`; this mirrors
 * them so the test does not have to import the module's private map.
 */
function provisionalMessage(reason: probeModule.ProbeRefusalReason): string {
  switch (reason) {
    case "incorrect-key":
      return "Incorrect API key.";
    case "model-not-found":
      return "That model isn't available on OpenAI.";
    case "unreachable":
      return "Could not reach OpenAI.";
    case "unknown-error":
      return "OpenAI could not validate the request. Please try again.";
  }
}

// Silence the unused-import lint when `createUser` is not referenced — the
// factory is imported because other future tests in this file are expected
// to use it; the helper is part of the suite's standard preamble.
void createUser;
