/**
 * @module api/__tests__/integration/http/ai.preferences
 * @description Catalogue and custom model preferences, the catalogue route and
 * the probe route.
 *
 * The provider is never called: `probeModel` and `getOpenRouterCatalog` are
 * mocked at the module boundary, so the assertions are about the controller's
 * orchestration (where capabilities come from, what is stored, what is refused),
 * not about the probe or the mapping, which have their own suites.
 *
 * @important The headline rule pinned here: capabilities are never read from the
 *            request. A client that sends them is ignored; the stored set is the
 *            server's own copy or measurement.
 */
import {
  afterAll,
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

vi.mock("../../../lib/ai/probe", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/ai/probe")>(
    "../../../lib/ai/probe",
  );
  return { ...actual, probeApiKey: vi.fn(async () => ({ ok: true as const })) };
});

vi.mock("../../../lib/ai/modelProbe", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/ai/modelProbe")
  >("../../../lib/ai/modelProbe");
  return { ...actual, probeModel: vi.fn() };
});

vi.mock("../../../lib/ai/openrouterCatalog", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/ai/openrouterCatalog")
  >("../../../lib/ai/openrouterCatalog");
  return { ...actual, getOpenRouterCatalog: vi.fn() };
});

import * as modelProbe from "../../../lib/ai/modelProbe";
import * as catalogModule from "../../../lib/ai/openrouterCatalog";

const app = createApp();
const FAKE_KEY = "sk-or-test-fake-key-DISTINCT12345678";
const MASTER_KEY = "test-only-encryption-key-placeholder-not-a-real-credential";

const CATALOG_MODELS: catalogModule.CatalogModel[] = [
  {
    id: "vendor/tooling",
    label: "Tooling",
    capabilities: ["streaming", "tools", "jsonMode"],
    pricing: { inputPerMTok: 1, outputPerMTok: 2 },
    contextLength: 8000,
  },
  {
    id: "vendor/plain",
    label: "Plain",
    capabilities: ["streaming"],
    pricing: null,
    contextLength: null,
  },
  {
    id: "openai/gpt-4o-mini",
    label: "OpenAI: GPT-4o mini",
    capabilities: ["streaming", "tools", "jsonMode", "vision"],
    pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6 },
    contextLength: 128000,
  },
];

let user: TestUser;
let savedKey: string | undefined;

beforeEach(async () => {
  await resetDatabase();
  savedKey = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = MASTER_KEY;
  vi.mocked(catalogModule.getOpenRouterCatalog).mockResolvedValue({
    models: CATALOG_MODELS,
    stale: false,
  });
  vi.mocked(modelProbe.probeModel).mockReset();

  user = await mintUser(app);
  await as(app, user)
    .post("/api/ai/credentials")
    .send({ providerId: "openrouter", apiKey: FAKE_KEY });
});

afterAll(async () => {
  if (savedKey === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = savedKey;
  await closeTestResources();
});

const save = (body: Record<string, unknown>) =>
  as(app, user).put("/api/ai/preferences").send(body);

describe("http: ai preferences, catalogue source", () => {
  it("saves a catalogue id with the server's copy of its capabilities", async () => {
    const res = await save({
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/tooling",
      source: "catalog",
    });

    expect(res.status).toBe(200);
    expect(res.body.responseObject).toMatchObject({
      modelId: "vendor/tooling",
      modelSource: "catalog",
      modelCapabilities: ["streaming", "tools", "jsonMode"],
    });
    await expect(
      testPrisma.aiFeaturePreference.findFirstOrThrow({
        where: { userId: user.id },
      }),
    ).resolves.toMatchObject({
      modelSource: "catalog",
      modelCapabilities: ["streaming", "tools", "jsonMode"],
    });
  });

  it("rejects an id that is not in the cached catalogue", async () => {
    const res = await save({
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/not-listed",
      source: "catalog",
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/not in the OpenRouter catalogue/i);
    expect(await testPrisma.aiFeaturePreference.count()).toBe(0);
  });

  it("ignores capabilities sent by the client", async () => {
    const res = await save({
      feature: "canvas",
      providerId: "openrouter",
      modelId: "vendor/plain",
      source: "catalog",
      // `vendor/plain` really has only streaming; the claim below must not count.
      capabilities: ["streaming", "jsonMode", "tools"],
      modelCapabilities: ["streaming", "jsonMode", "tools"],
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/lacks jsonMode/);
    expect(await testPrisma.aiFeaturePreference.count()).toBe(0);
  });

  it("stores the server's capabilities, not the client's, on success", async () => {
    const res = await save({
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/tooling",
      source: "catalog",
      capabilities: ["vision", "reasoning"],
    });

    expect(res.status).toBe(200);
    expect(res.body.responseObject.modelCapabilities).toEqual([
      "streaming",
      "tools",
      "jsonMode",
    ]);
  });

  it("refuses a catalogue source for a provider that has no catalogue", async () => {
    await as(app, user)
      .post("/api/ai/credentials")
      .send({ providerId: "openai", apiKey: FAKE_KEY });

    const res = await save({
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
      source: "catalog",
    });

    expect(res.status).toBe(422);
  });

  it("answers 503 when the catalogue is unreachable and nothing is cached", async () => {
    vi.mocked(catalogModule.getOpenRouterCatalog).mockRejectedValue(
      new catalogModule.CatalogUnavailableError(),
    );

    const res = await save({
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/tooling",
      source: "catalog",
    });

    expect(res.status).toBe(503);
  });
});

describe("http: ai preferences, custom source", () => {
  it("saves a custom id only after a passing probe, storing the measured set", async () => {
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: true,
      capabilities: ["tools", "streaming"],
      servesFeatures: ["chat", "markdown"],
    });

    const res = await save({
      feature: "markdown",
      providerId: "openrouter",
      modelId: "vendor/custom",
      source: "custom",
      capabilities: ["vision"],
    });

    expect(res.status).toBe(200);
    expect(modelProbe.probeModel).toHaveBeenCalledTimes(1);
    expect(res.body.responseObject).toMatchObject({
      modelSource: "custom",
      modelCapabilities: ["tools", "streaming"],
    });
  });

  it("does not save when the probe rejects the id", async () => {
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: false,
      reason: "model-not-found",
      message: "That model is not available on OpenRouter.",
    });

    const res = await save({
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/typo",
      source: "custom",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not available/);
    expect(await testPrisma.aiFeaturePreference.count()).toBe(0);
  });

  it("does not save a measured model that cannot serve the feature", async () => {
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: true,
      capabilities: ["streaming"],
      servesFeatures: ["markdown"],
    });

    const res = await save({
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/custom",
      source: "custom",
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/lacks tools/);
    expect(await testPrisma.aiFeaturePreference.count()).toBe(0);
  });

  it("reuses a probe result under ten minutes old instead of probing again", async () => {
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: true,
      capabilities: ["tools", "streaming"],
      servesFeatures: ["chat", "markdown"],
    });

    const probe = await as(app, user)
      .post("/api/ai/models/probe")
      .send({ providerId: "openrouter", modelId: "vendor/custom" });
    expect(probe.status).toBe(200);

    const res = await save({
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/custom",
      source: "custom",
    });

    expect(res.status).toBe(200);
    expect(modelProbe.probeModel).toHaveBeenCalledTimes(1);
  });

  it("overwrites a previous custom preference with a registry one, clearing capabilities", async () => {
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: true,
      capabilities: ["tools", "streaming"],
      servesFeatures: ["chat", "markdown"],
    });
    await save({
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/custom",
      source: "custom",
    });

    const res = await save({
      feature: "chat",
      providerId: "openrouter",
      modelId: "openai/gpt-4o-mini",
    });

    expect(res.status).toBe(200);
    expect(res.body.responseObject).toMatchObject({
      modelSource: "registry",
      modelCapabilities: [],
    });
  });
});

describe("http: ai model probe route", () => {
  it("returns the measured capabilities and the features they serve", async () => {
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: true,
      capabilities: ["tools", "streaming", "jsonMode"],
      servesFeatures: ["chat", "markdown", "canvas"],
    });

    const res = await as(app, user)
      .post("/api/ai/models/probe")
      .send({ providerId: "openrouter", modelId: "vendor/custom" });

    expect(res.status).toBe(200);
    expect(res.body.responseObject).toEqual({
      capabilities: ["tools", "streaming", "jsonMode"],
      servesFeatures: ["chat", "markdown", "canvas"],
    });
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
  });

  it("probes with the caller's own decrypted key", async () => {
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: true,
      capabilities: [],
      servesFeatures: [],
    });

    await as(app, user)
      .post("/api/ai/models/probe")
      .send({ providerId: "openrouter", modelId: "vendor/custom" });

    expect(vi.mocked(modelProbe.probeModel).mock.calls[0]![1]).toBe(FAKE_KEY);
  });

  it("refuses with 422 when the caller has no key for the provider", async () => {
    const res = await as(app, user)
      .post("/api/ai/models/probe")
      .send({ providerId: "groq", modelId: "llama-3.3-70b-versatile" });

    expect(res.status).toBe(422);
    expect(modelProbe.probeModel).not.toHaveBeenCalled();
  });

  it("maps a rejected id to 400 with the curated reason", async () => {
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: false,
      reason: "incorrect-key",
      message: "Incorrect API key.",
    });

    const res = await as(app, user)
      .post("/api/ai/models/probe")
      .send({ providerId: "openrouter", modelId: "vendor/custom" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Incorrect API key.");
  });

  it("validates the body at the edge", async () => {
    const res = await as(app, user)
      .post("/api/ai/models/probe")
      .send({ providerId: "openrouter", modelId: "" });

    expect(res.status).toBe(400);
  });
});

describe("http: ai catalogue route", () => {
  it("filters by the feature's hard requirements and puts registry picks first", async () => {
    const res = await as(app, user).get(
      "/api/ai/catalog/openrouter?feature=chat",
    );

    expect(res.status).toBe(200);
    const ids = res.body.responseObject.models.map((m: { id: string }) => m.id);
    expect(ids).toEqual(["openai/gpt-4o-mini", "vendor/tooling"]);
    expect(res.body.responseObject.models[0].curated).toBe(true);
    expect(res.body.responseObject.stale).toBe(false);
  });

  it("returns everything when no feature is given, sorted by name within a group", async () => {
    const res = await as(app, user).get("/api/ai/catalog/openrouter");

    const ids = res.body.responseObject.models.map((m: { id: string }) => m.id);
    expect(ids).toEqual(["openai/gpt-4o-mini", "vendor/plain", "vendor/tooling"]);
  });

  it("rejects an unknown feature", async () => {
    const res = await as(app, user).get(
      "/api/ai/catalog/openrouter?feature=weird",
    );

    expect(res.status).toBe(400);
  });

  it("answers 503 when the catalogue is unavailable", async () => {
    vi.mocked(catalogModule.getOpenRouterCatalog).mockRejectedValue(
      new catalogModule.CatalogUnavailableError(),
    );

    const res = await as(app, user).get("/api/ai/catalog/openrouter");

    expect(res.status).toBe(503);
  });

  it("requires authentication", async () => {
    const { default: request } = await import("supertest");

    const res = await request(app).get("/api/ai/catalog/openrouter");

    expect(res.status).toBe(401);
  });
});
