/**
 * @module api/__tests__/integration/http/ai.isolation
 * @description Cross-user isolation on the BYOK surface.
 *
 * The plan calls this out specifically: a credential that is not the
 * caller's returns **404, not 403** — the same non-disclosure choice
 * `getWorkspaceBySlugId` makes for non-members of a workspace. The row
 * does not exist as far as this caller is concerned. The pin matters
 * because 403 would leak existence: B can tell that A has a credential
 * even when B cannot read it.
 *
 * Three things are asserted here, against each of the credential routes
 * (`GET /:providerId` via DELETE, `POST` replace, status read):
 *
 *   1. B's request yields 404.
 *   2. A's row is unchanged.
 *   3. B's status response never contains A's fingerprint or preview.
 *
 * @important The `POST /credentials` flow runs through the probe. The probe
 *            is mocked here at the module boundary so isolation tests are
 *            fast and deterministic — what is being asserted is the
 *            controller's `where: { userId }` scoping, not the probe.
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
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";

// Mock the probe so we never hit a real provider. The default is success;
// individual tests can override.
vi.mock("../../../lib/ai/probe", async () => {
  const actual =
    await vi.importActual<typeof import("../../../lib/ai/probe")>(
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

const A_KEY = "sk-alice-A-KEY-AAAA1111";
const B_KEY = "sk-bob-B-KEY-BBBB2222";

describe("ai isolation: cross-user credential access", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    alice = await mintUser(app);
    bob = await mintUser(app);

    // Alice saves a key for openai. Bob is a real, authenticated user with
    // no credential of his own.
    await as(app, alice)
      .post("/api/ai/credentials")
      .send({ providerId: "openai", apiKey: A_KEY });
  });

  it("404s Bob's DELETE against Alice's providerId", async () => {
    const res = await as(app, bob).delete("/api/ai/credentials/openai");

    expect(res.status).toBe(404);
  });

  it("leaves Alice's credential unchanged after Bob's DELETE", async () => {
    await as(app, bob).delete("/api/ai/credentials/openai");

    const stored = await testPrisma.aiCredential.findUnique({
      where: {
        userId_providerId: { userId: alice.id, providerId: "openai" },
      },
    });
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe(alice.id);
  });

  it("Bob's status never contains Alice's credential preview", async () => {
    const res = await as(app, bob).get("/api/ai/status");

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("sk-…1111");
    expect(body).not.toContain(A_KEY);
    expect(body).not.toContain("DISTINCT");
    // Bob's list is empty — encryption is configured but he has no row.
    expect(res.body.responseObject.credentials).toEqual([]);
  });

  it("Bob's list never contains Alice's credential preview", async () => {
    const res = await as(app, bob).get("/api/ai/credentials");

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("sk-…1111");
    expect(body).not.toContain(A_KEY);
    expect(res.body.responseObject).toEqual([]);
  });

  it("Bob's POST for the same providerId creates a row owned by Bob, not Alice", async () => {
    // A separate setup: we want to assert that the upsert key is
    // `(userId, providerId)`, so Bob saving his own key for openai does
    // not collide with Alice's row.
    const res = await as(app, bob)
      .post("/api/ai/credentials")
      .send({ providerId: "openai", apiKey: B_KEY });

    expect(res.status).toBe(201);

    // Two rows now exist — one per user.
    const all = await testPrisma.aiCredential.findMany({
      where: { providerId: "openai" },
      orderBy: { createdAt: "asc" },
    });
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.userId).sort()).toEqual([alice.id, bob.id].sort());

    // Bob sees his own row; Alice's row is untouched.
    const bobList = await as(app, bob).get("/api/ai/credentials");
    expect(bobList.body.responseObject).toHaveLength(1);
    expect(bobList.body.responseObject[0].maskedPreview).toBe("sk-…2222");

    const aliceList = await as(app, alice).get("/api/ai/credentials");
    expect(aliceList.body.responseObject).toHaveLength(1);
    expect(aliceList.body.responseObject[0].maskedPreview).toBe("sk-…1111");
  });

  it("Bob cannot save a preference for Alice's providerId (422 — no credential for that provider)", async () => {
    // Bob has no credential, so attempting to point a preference at
    // openai — Alice's provider — is rejected as 422 with the same
    // message as for any other missing credential.
    const res = await as(app, bob)
      .put("/api/ai/preferences")
      .send({
        feature: "chat",
        providerId: "openai",
        modelId: "gpt-5-nano",
      });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/no credential saved/i);

    // Alice's preferences are unchanged.
    const alicePrefs = await testPrisma.aiFeaturePreference.findMany({
      where: { userId: alice.id },
    });
    expect(alicePrefs).toEqual([]);

    const bobPrefs = await testPrisma.aiFeaturePreference.findMany({
      where: { userId: bob.id },
    });
    expect(bobPrefs).toEqual([]);
  });

  it("Bob's preferences are never returned in Alice's list response", async () => {
    // Bob saves a credential for groq and a preference for it.
    await as(app, bob)
      .post("/api/ai/credentials")
      .send({ providerId: "groq", apiKey: B_KEY });
    await as(app, bob)
      .put("/api/ai/preferences")
      .send({
        feature: "chat",
        providerId: "groq",
        modelId: "openai/gpt-oss-120b",
      });

    const alicePrefs = await as(app, alice).get("/api/ai/preferences");

    expect(alicePrefs.status).toBe(200);
    const body = JSON.stringify(alicePrefs.body);
    expect(body).not.toContain("groq");
    expect(body).not.toContain("gpt-oss-120b");
    expect(body).not.toContain(B_KEY);
    expect(body).not.toContain("DISTINCT");
    expect(alicePrefs.body.responseObject.chat).toBeNull();
    expect(alicePrefs.body.responseObject.markdown).toBeNull();
    expect(alicePrefs.body.responseObject.canvas).toBeNull();
  });
});
