/**
 * @module api/__tests__/integration/http/ai.workspace
 * @description Every `/api/ai` route, driven through the real app and database
 * as an owner, an admin, a member and a non-member.
 *
 * Provider traffic is never real: the credential probe, the model probe and the
 * OpenRouter catalogue are mocked at the module boundary, so the assertions are
 * about the controllers' orchestration (who may do what, what is stored, what is
 * refused), not about the probes, which have their own suites.
 *
 * @important Capabilities are never read from the request body: a client that
 *            sends them is ignored. And no response, on any route, carries a
 *            key, an envelope, a key id or a fingerprint; only the masked
 *            preview.
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
import { createApp } from "../../../app";
import {
  TEST_AI_KEY,
  addMember,
  as,
  closeTestResources,
  createUser,
  createWorkspace,
  createWorkspaceAiCredential,
  createWorkspaceAiPreference,
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";
import { buildAad, decryptSecret } from "../../../lib/ai/credentialCrypto";

vi.mock("../../../lib/ai/probe", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/ai/probe")>(
    "../../../lib/ai/probe",
  );
  return { ...actual, probeCredential: vi.fn() };
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

import * as probe from "../../../lib/ai/probe";
import * as modelProbe from "../../../lib/ai/modelProbe";
import * as catalogModule from "../../../lib/ai/openrouterCatalog";
import { pubClient } from "../../../lib/redis";

const app = createApp();

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
];

let owner: TestUser;
let admin: TestUser;
let member: TestUser;
let outsider: TestUser;
let workspaceId: string;
let base: string;

const probeOk = (
  verifiedKinds: Array<"text" | "transcription" | "speech"> = ["text"],
  warnings: string[] = [],
) =>
  vi
    .mocked(probe.probeCredential)
    .mockResolvedValue({ ok: true, verifiedKinds, warnings });

beforeAll(async () => {
  await resetDatabase();
  owner = await mintUser(app);
  admin = await mintUser(app);
  member = await mintUser(app);
  outsider = await mintUser(app);
});

beforeEach(async () => {
  // Users and sessions persist across tests (minting is slow); everything a
  // test creates hangs off a workspace or the caller's counters, so removing
  // the workspaces and resetting the counters is a clean slate.
  await testPrisma.workspace.deleteMany({});
  await testPrisma.user.updateMany({
    data: { freeDocGenerationsUsed: 0, freeVoiceSecondsUsed: 0 },
  });
  await pubClient.flushdb();
  vi.mocked(probe.probeCredential).mockReset();
  vi.mocked(modelProbe.probeModel).mockReset();
  vi.mocked(catalogModule.getOpenRouterCatalog).mockResolvedValue({
    models: CATALOG_MODELS,
    stale: false,
  });
  probeOk();

  workspaceId = (await createWorkspace(owner.id)).id;
  await addMember(workspaceId, admin.id, "ADMIN");
  await addMember(workspaceId, member.id, "MEMBER");
  base = `/api/ai/workspaces/${workspaceId}`;
});

afterAll(async () => {
  await closeTestResources();
});

const saveKey = (user: TestUser, body: Record<string, unknown> = {}) =>
  as(app, user)
    .post(`${base}/credentials`)
    .send({ providerId: "openai", apiKey: TEST_AI_KEY, ...body });

const savePref = (user: TestUser, body: Record<string, unknown>) =>
  as(app, user).put(`${base}/preferences`).send(body);

// ── Access matrix ───────────────────────────────────────────────────────────

describe("access by role", () => {
  type Route = {
    name: string;
    call: (u: TestUser) => Promise<{ status: number }>;
    minRole: "member" | "admin";
  };

  const routes: Route[] = [
    { name: "GET status", minRole: "member", call: (u) => as(app, u).get(`${base}/status`) },
    { name: "GET preferences", minRole: "member", call: (u) => as(app, u).get(`${base}/preferences`) },
    { name: "GET settings", minRole: "member", call: (u) => as(app, u).get(`${base}/settings`) },
    { name: "GET credentials", minRole: "admin", call: (u) => as(app, u).get(`${base}/credentials`) },
    { name: "POST credentials", minRole: "admin", call: (u) => saveKey(u) },
    { name: "DELETE credentials", minRole: "admin", call: (u) => as(app, u).delete(`${base}/credentials/openai`) },
    { name: "PUT preferences", minRole: "admin", call: (u) => savePref(u, { feature: "chat", providerId: "openai", modelId: "gpt-5-nano" }) },
    { name: "PUT settings", minRole: "admin", call: (u) => as(app, u).put(`${base}/settings`).send({ assistantEnabled: true }) },
    { name: "GET usage", minRole: "admin", call: (u) => as(app, u).get(`${base}/usage`) },
    { name: "GET catalog", minRole: "admin", call: (u) => as(app, u).get(`${base}/catalog/openrouter?feature=chat`) },
    { name: "POST models/probe", minRole: "admin", call: (u) => as(app, u).post(`${base}/models/probe`).send({ providerId: "openrouter", modelId: "vendor/tooling" }) },
  ];

  for (const route of routes) {
    describe(route.name, () => {
      it("answers 404 to a non-member, never 403", async () => {
        const res = await route.call(outsider);
        expect(res.status).toBe(404);
      });

      if (route.minRole === "admin") {
        it("answers 403 to a member", async () => {
          const res = await route.call(member);
          expect(res.status).toBe(403);
        });
      }

      it("lets an admin and the owner through", async () => {
        // Fresh state per call so a prior write does not change the outcome.
        const a = await route.call(admin);
        const o = await route.call(owner);
        for (const status of [a.status, o.status]) {
          expect([200, 201, 404, 422, 400]).toContain(status);
          expect(status).not.toBe(403);
        }
        // 404 is allowed only for the DELETE of a credential that is not there.
        if (route.name !== "DELETE credentials") {
          expect(a.status).not.toBe(404);
        }
      });
    });
  }

  it("rejects an unauthenticated request", async () => {
    const res = await (await import("supertest")).default(app).get(`${base}/status`);
    expect(res.status).toBe(401);
  });
});

// ── Credentials ─────────────────────────────────────────────────────────────

describe("credentials", () => {
  it("creates a credential: 201, masked preview only, verified kinds returned", async () => {
    probeOk(["text", "transcription"], ["Speech models could not be verified: x"]);
    const res = await saveKey(admin, { label: "team" });

    expect(res.status).toBe(201);
    expect(res.body.responseObject).toMatchObject({
      providerId: "openai",
      label: "team",
      verifiedKinds: ["text", "transcription"],
      warnings: ["Speech models could not be verified: x"],
    });
    expect(res.body.responseObject.maskedPreview).toBeTruthy();
    expect(res.body.message).toContain("Speech models could not be verified");

    const row = await testPrisma.workspaceAiCredential.findFirstOrThrow();
    expect(row.workspaceId).toBe(workspaceId);
    expect(row.createdById).toBe(admin.id);
    expect(row.verifiedKinds).toEqual(["text", "transcription"]);
    expect(row.keyEnvelope).not.toContain(TEST_AI_KEY);
    expect(
      decryptSecret(
        row.keyEnvelope,
        buildAad({ kind: "workspace", workspaceId }, "openai"),
      ),
    ).toBe(TEST_AI_KEY);
  });

  it("replaces an existing credential with 200", async () => {
    await saveKey(admin);
    const second = await saveKey(owner, { apiKey: "sk-test-fake-replacement-9999" });
    expect(second.status).toBe(200);
    expect(await testPrisma.workspaceAiCredential.count()).toBe(1);
  });

  it("stores nothing when the key is refused", async () => {
    vi.mocked(probe.probeCredential).mockResolvedValue({
      ok: false,
      reason: "incorrect-key",
      message: "Incorrect API key.",
    });
    const res = await saveKey(admin);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Incorrect API key.");
    expect(await testPrisma.workspaceAiCredential.count()).toBe(0);
  });

  it("validates the body", async () => {
    const noKey = await as(app, admin).post(`${base}/credentials`).send({ providerId: "openai" });
    expect(noKey.status).toBe(400);
    const badProvider = await saveKey(admin, { providerId: "nope" });
    expect(badProvider.status).toBe(400);
    const longKey = await saveKey(admin, { apiKey: "k".repeat(600) });
    expect(longKey.status).toBe(400);
  });

  it("lists a workspace's credentials without any secret field", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai");
    const res = await as(app, admin).get(`${base}/credentials`);
    expect(res.status).toBe(200);
    expect(res.body.responseObject).toHaveLength(1);
    const text = JSON.stringify(res.body);
    for (const forbidden of ["keyEnvelope", "keyId", "keyFingerprint", "nimbus1.", TEST_AI_KEY]) {
      expect(text).not.toContain(forbidden);
    }
    expect(res.body.responseObject[0].maskedPreview).toBe("sk-…5678");
  });

  it("does not list another workspace's credentials", async () => {
    const other = await createUser();
    const otherWs = await createWorkspace(other.id);
    await createWorkspaceAiCredential(otherWs.id, "groq");
    const res = await as(app, admin).get(`${base}/credentials`);
    expect(res.body.responseObject).toEqual([]);
  });

  it("deletes a credential and the preferences that used its provider", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai");
    await createWorkspaceAiPreference(workspaceId, "CHAT", "openai", "gpt-5-nano");
    await createWorkspaceAiPreference(workspaceId, "CANVAS", "deepseek", "deepseek-flash");

    const res = await as(app, admin).delete(`${base}/credentials/openai`);
    expect(res.status).toBe(200);
    expect(res.body.responseObject).toEqual({ clearedPreferences: 1 });
    expect(await testPrisma.workspaceAiCredential.count()).toBe(0);
    expect(await testPrisma.workspaceAiPreference.count()).toBe(1);
  });

  it("answers 404 when deleting a credential that does not exist", async () => {
    const res = await as(app, admin).delete(`${base}/credentials/openai`);
    expect(res.status).toBe(404);
  });

  it("cannot delete a credential in a workspace the caller is not in", async () => {
    const other = await createUser();
    const otherWs = await createWorkspace(other.id);
    await createWorkspaceAiCredential(otherWs.id, "openai");
    const res = await as(app, admin).delete(
      `/api/ai/workspaces/${otherWs.id}/credentials/openai`,
    );
    expect(res.status).toBe(404);
    expect(await testPrisma.workspaceAiCredential.count()).toBe(1);
  });
});

// ── Preferences ─────────────────────────────────────────────────────────────

describe("preferences", () => {
  it("starts empty for every feature, readable by a member", async () => {
    const res = await as(app, member).get(`${base}/preferences`);
    expect(res.status).toBe(200);
    const prefs = res.body.responseObject as Record<string, unknown>;
    expect(Object.keys(prefs).sort()).toEqual(
      ["canvas", "chat", "markdown", "meeting", "speech", "transcription", "vision"].sort(),
    );
    expect(Object.values(prefs).every((v) => v === null)).toBe(true);
  });

  it("saves a registry preference and shows it to members", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai");
    const saved = await savePref(admin, {
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.responseObject).toMatchObject({
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
      modelSource: "registry",
    });
    const list = await as(app, member).get(`${base}/preferences`);
    expect(list.body.responseObject.chat).toMatchObject({ modelId: "gpt-5-nano" });
  });

  it("refuses a provider the workspace has no key for", async () => {
    const res = await savePref(admin, {
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
    });
    expect(res.status).toBe(422);
  });

  it("refuses an unknown or incapable registry model", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai");
    const unknown = await savePref(admin, {
      feature: "chat",
      providerId: "openai",
      modelId: "no-such-model",
    });
    expect(unknown.status).toBe(422);

    const tts = await savePref(admin, {
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-4o-mini-tts",
    });
    expect(tts.status).toBe(422);
  });

  it("refuses a kind the key was not verified for", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", { verifiedKinds: ["text"] });
    const res = await savePref(admin, {
      feature: "transcription",
      providerId: "openai",
      modelId: "gpt-4o-mini-transcribe",
    });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/not been verified/);
  });

  it("saves a transcription preference when the key is verified for it", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text", "transcription"],
    });
    const res = await savePref(admin, {
      feature: "transcription",
      providerId: "openai",
      modelId: "gpt-4o-mini-transcribe",
    });
    expect(res.status).toBe(200);
    expect(res.body.responseObject).toMatchObject({ feature: "transcription" });
  });

  it("saves a speech preference with a voice, and refuses an unknown voice", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text", "speech"],
    });
    const ok = await savePref(admin, {
      feature: "speech",
      providerId: "openai",
      modelId: "gpt-4o-mini-tts",
      voice: "coral",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.responseObject).toMatchObject({ voice: "coral" });

    const bad = await savePref(admin, {
      feature: "speech",
      providerId: "openai",
      modelId: "gpt-4o-mini-tts",
      voice: "nobody",
    });
    expect(bad.status).toBe(422);
  });

  it("refuses a voice on a feature that is not speech", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai");
    const res = await savePref(admin, {
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
      voice: "coral",
    });
    expect(res.status).toBe(422);
  });

  it("refuses a custom or catalogue source for an audio feature", async () => {
    await createWorkspaceAiCredential(workspaceId, "openrouter", {
      verifiedKinds: ["text", "transcription"],
    });
    const res = await savePref(admin, {
      feature: "transcription",
      providerId: "openrouter",
      modelId: "vendor/x",
      source: "custom",
    });
    expect(res.status).toBe(422);
  });

  it("stores the catalogue's own capabilities and ignores any the client sends", async () => {
    await createWorkspaceAiCredential(workspaceId, "openrouter");
    const res = await savePref(admin, {
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/tooling",
      source: "catalog",
      capabilities: ["reasoning", "vision"],
    });
    expect(res.status).toBe(200);
    const row = await testPrisma.workspaceAiPreference.findFirstOrThrow();
    expect([...row.modelCapabilities].sort()).toEqual(["jsonMode", "streaming", "tools"]);
  });

  it("refuses a catalogue model that lacks the feature's requirements", async () => {
    await createWorkspaceAiCredential(workspaceId, "openrouter");
    const res = await savePref(admin, {
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/plain",
      source: "catalog",
    });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/lacks/);
  });

  it("refuses a catalogue source for a provider without a catalogue", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai");
    const res = await savePref(admin, {
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
      source: "catalog",
    });
    expect(res.status).toBe(422);
  });

  it("measures a custom id with the workspace key and stores what it found", async () => {
    await createWorkspaceAiCredential(workspaceId, "openrouter", {
      apiKey: "sk-or-test-fake-key-DISTINCT12345678",
    });
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: true,
      capabilities: ["streaming", "tools", "jsonMode"],
    } as never);
    const res = await savePref(admin, {
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/custom",
      source: "custom",
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(modelProbe.probeModel)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(modelProbe.probeModel).mock.calls[0]![1]).toBe(
      "sk-or-test-fake-key-DISTINCT12345678",
    );
    const row = await testPrisma.workspaceAiPreference.findFirstOrThrow();
    expect(row.modelSource).toBe("custom");
  });

  it("surfaces a refused custom id as a 400 with the probe's message", async () => {
    await createWorkspaceAiCredential(workspaceId, "openrouter");
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: false,
      reason: "model-not-found",
      message: "That model isn't available on OpenRouter.",
    } as never);
    const res = await savePref(admin, {
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/missing",
      source: "custom",
    });
    expect(res.status).toBe(400);
    expect(await testPrisma.workspaceAiPreference.count()).toBe(0);
  });

  it("validates the body", async () => {
    const res = await savePref(admin, { feature: "dancing", providerId: "openai", modelId: "x" });
    expect(res.status).toBe(400);
  });
});

// ── Settings ────────────────────────────────────────────────────────────────

describe("settings", () => {
  it("returns defaults with month-to-date spend, readable by a member", async () => {
    const res = await as(app, member).get(`${base}/settings`);
    expect(res.status).toBe(200);
    expect(res.body.responseObject).toEqual({
      monthlySpendCapUsd: null,
      assistantEnabled: true,
      assistantSpeaks: true,
      monthToDateCostUsd: 0,
    });
  });

  it("sets, partially updates and clears the cap", async () => {
    const set = await as(app, admin)
      .put(`${base}/settings`)
      .send({ monthlySpendCapUsd: 25.5 });
    expect(set.status).toBe(200);
    expect(set.body.responseObject.monthlySpendCapUsd).toBe(25.5);

    const toggled = await as(app, owner)
      .put(`${base}/settings`)
      .send({ assistantSpeaks: false });
    expect(toggled.body.responseObject).toMatchObject({
      monthlySpendCapUsd: 25.5,
      assistantSpeaks: false,
      assistantEnabled: true,
    });

    const cleared = await as(app, admin)
      .put(`${base}/settings`)
      .send({ monthlySpendCapUsd: null });
    expect(cleared.body.responseObject.monthlySpendCapUsd).toBeNull();
  });

  it("rejects an empty update, a zero or negative cap, and sub-cent precision", async () => {
    for (const body of [
      {},
      { monthlySpendCapUsd: 0 },
      { monthlySpendCapUsd: -1 },
      { monthlySpendCapUsd: 1.234 },
      { monthlySpendCapUsd: 2_000_000 },
    ]) {
      const res = await as(app, admin).put(`${base}/settings`).send(body);
      expect(res.status).toBe(400);
    }
  });
});

// ── Usage ───────────────────────────────────────────────────────────────────

describe("usage", () => {
  const addCalls = async (n: number, extra: Record<string, unknown> = {}) => {
    for (let i = 0; i < n; i += 1) {
      await testPrisma.aiCall.create({
        data: {
          workspaceId,
          userId: member.id,
          feature: "CHAT",
          providerId: "openai",
          modelId: "gpt-5-nano",
          source: "BYOK",
          status: "OK",
          latencyMs: 10 + i,
          costUsd: 0.5,
          createdAt: new Date(Date.now() - i * 1000),
          ...extra,
        },
      });
    }
  };

  it("pages newest first with a cursor and no duplicates", async () => {
    await addCalls(5);
    const first = await as(app, admin).get(`${base}/usage?limit=2`);
    expect(first.status).toBe(200);
    expect(first.body.responseObject.calls).toHaveLength(2);
    expect(first.body.responseObject.nextCursor).toBeTruthy();

    const second = await as(app, admin).get(
      `${base}/usage?limit=2&cursor=${encodeURIComponent(first.body.responseObject.nextCursor)}`,
    );
    const third = await as(app, admin).get(
      `${base}/usage?limit=2&cursor=${encodeURIComponent(second.body.responseObject.nextCursor)}`,
    );
    expect(third.body.responseObject.calls).toHaveLength(1);
    expect(third.body.responseObject.nextCursor).toBeNull();

    const ids = [first, second, third].flatMap((r) =>
      r.body.responseObject.calls.map((c: { id: string }) => c.id),
    );
    expect(new Set(ids).size).toBe(5);
  });

  it("reports this month's totals per feature and names the member", async () => {
    await addCalls(3);
    await addCalls(1, { feature: "TRANSCRIPTION", audioSeconds: 30, costUsd: 0.25 });
    const res = await as(app, owner).get(`${base}/usage`);
    const { totals, calls } = res.body.responseObject;
    expect(totals.totalCalls).toBe(4);
    expect(totals.totalCostUsd).toBeCloseTo(1.75, 6);
    const chat = totals.byFeature.find((f: { feature: string }) => f.feature === "chat");
    expect(chat).toMatchObject({ calls: 3 });
    expect(calls[0].userName).toBeTruthy();
    expect(calls[0].source).toBe("byok");
  });

  it("filters by feature, status and user", async () => {
    await addCalls(2);
    await addCalls(1, { feature: "CANVAS", status: "ERROR", errorReason: "timeout", userId: owner.id });
    const byFeature = await as(app, admin).get(`${base}/usage?feature=canvas`);
    expect(byFeature.body.responseObject.calls).toHaveLength(1);
    const byStatus = await as(app, admin).get(`${base}/usage?status=error`);
    expect(byStatus.body.responseObject.calls[0].errorReason).toBe("timeout");
    const byUser = await as(app, admin).get(`${base}/usage?userId=${member.id}`);
    expect(byUser.body.responseObject.calls).toHaveLength(2);
  });

  it("does not show another workspace's calls", async () => {
    const other = await createUser();
    const otherWs = await createWorkspace(other.id);
    await testPrisma.aiCall.create({
      data: {
        workspaceId: otherWs.id,
        userId: other.id,
        feature: "CHAT",
        providerId: "openai",
        modelId: "gpt-5-nano",
        source: "BYOK",
        status: "OK",
        latencyMs: 1,
      },
    });
    const res = await as(app, admin).get(`${base}/usage`);
    expect(res.body.responseObject.calls).toEqual([]);
  });

  it("rejects a malformed cursor and out-of-range query values", async () => {
    expect((await as(app, admin).get(`${base}/usage?cursor=garbage`)).status).toBe(400);
    expect((await as(app, admin).get(`${base}/usage?limit=0`)).status).toBe(400);
    expect((await as(app, admin).get(`${base}/usage?limit=101`)).status).toBe(400);
    expect((await as(app, admin).get(`${base}/usage?feature=nope`)).status).toBe(400);
    expect((await as(app, admin).get(`${base}/usage?status=nope`)).status).toBe(400);
  });
});

// ── Status ──────────────────────────────────────────────────────────────────

describe("status", () => {
  it("reports a configured workspace key as enabled, and canManage by role", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai");
    const asAdmin = await as(app, admin).get(`${base}/status`);
    expect(asAdmin.body.responseObject.canManage).toBe(true);
    expect(asAdmin.body.responseObject.features.chat).toMatchObject({
      enabled: true,
      providerId: null,
      reason: null,
    });
    const asMember = await as(app, member).get(`${base}/status`);
    expect(asMember.body.responseObject.canManage).toBe(false);
  });

  it("explains why chat is off when there is no key and no free tier", async () => {
    const saved = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;
    try {
      const res = await as(app, member).get(`${base}/status`);
      expect(res.body.responseObject.features.chat).toMatchObject({
        enabled: false,
        reason: "no-operator-key",
      });
    } finally {
      if (saved !== undefined) process.env.AI_API_KEY = saved;
    }
  });

  it("turns own-key features off once the spend cap is reached", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai");
    await testPrisma.workspaceAiSettings.create({
      data: { workspaceId, monthlySpendCapUsd: 1 },
    });
    await testPrisma.aiCall.create({
      data: {
        workspaceId,
        userId: member.id,
        feature: "CHAT",
        providerId: "openai",
        modelId: "gpt-5-nano",
        source: "BYOK",
        status: "OK",
        latencyMs: 1,
        costUsd: 5,
      },
    });
    const res = await as(app, member).get(`${base}/status`);
    expect(res.body.responseObject.features.chat).toMatchObject({
      enabled: false,
      reason: "spend-cap-reached",
    });
  });

  it("reports voice as unavailable without a verified key", async () => {
    const res = await as(app, member).get(`${base}/status`);
    expect(res.body.responseObject.voice).toMatchObject({ available: false });
    expect(res.body.responseObject.features.transcription.enabled).toBe(false);
  });
});

// ── Catalogue and model probe ───────────────────────────────────────────────

describe("catalogue and model probe", () => {
  it("filters the catalogue to models meeting the feature's requirements", async () => {
    const res = await as(app, admin).get(`${base}/catalog/openrouter?feature=chat`);
    expect(res.status).toBe(200);
    expect(res.body.responseObject.models.map((m: { id: string }) => m.id)).toEqual([
      "vendor/tooling",
    ]);
  });

  it("lists the registry's own picks first, then by name", async () => {
    vi.mocked(catalogModule.getOpenRouterCatalog).mockResolvedValue({
      models: [
        { id: "vendor/zeta", label: "Zeta", capabilities: ["streaming", "tools", "jsonMode"], pricing: null, contextLength: null },
        { id: "vendor/alpha", label: "Alpha", capabilities: ["streaming", "tools", "jsonMode"], pricing: null, contextLength: null },
        { id: "openai/gpt-transcribe", label: "Transcribe", capabilities: ["streaming", "tools", "jsonMode"], pricing: null, contextLength: null },
      ],
      stale: false,
    });
    const res = await as(app, admin).get(`${base}/catalog/openrouter?feature=chat`);
    const models = res.body.responseObject.models as Array<{ id: string; curated: boolean }>;
    expect(models.map((m) => m.id)).toEqual([
      "openai/gpt-transcribe",
      "vendor/alpha",
      "vendor/zeta",
    ]);
    expect(models[0]!.curated).toBe(true);
    expect(models[1]!.curated).toBe(false);
  });

  it("answers 503 when the catalogue is unavailable", async () => {
    vi.mocked(catalogModule.getOpenRouterCatalog).mockRejectedValue(
      new catalogModule.CatalogUnavailableError("down"),
    );
    const res = await as(app, admin).get(`${base}/catalog/openrouter?feature=chat`);
    expect(res.status).toBe(503);
  });

  it("rejects an unknown feature", async () => {
    const res = await as(app, admin).get(`${base}/catalog/openrouter?feature=nope`);
    expect(res.status).toBe(400);
  });

  it("probes a model id with the workspace's key", async () => {
    await createWorkspaceAiCredential(workspaceId, "openrouter", {
      apiKey: "sk-or-test-fake-key-DISTINCT12345678",
    });
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: true,
      capabilities: ["streaming", "tools", "jsonMode"],
    } as never);
    const res = await as(app, admin)
      .post(`${base}/models/probe`)
      .send({ providerId: "openrouter", modelId: "vendor/x" });
    expect(res.status).toBe(200);
    expect(res.body.responseObject.servesFeatures).toContain("chat");
    expect(JSON.stringify(res.body)).not.toContain("DISTINCT12345678");
  });

  it("answers 422 when the workspace has no key for the provider", async () => {
    const res = await as(app, admin)
      .post(`${base}/models/probe`)
      .send({ providerId: "openrouter", modelId: "vendor/x" });
    expect(res.status).toBe(422);
  });

  it("answers 400 with the probe's message when the id is refused", async () => {
    await createWorkspaceAiCredential(workspaceId, "openrouter");
    vi.mocked(modelProbe.probeModel).mockResolvedValue({
      ok: false,
      reason: "model-not-found",
      message: "That model isn't available on OpenRouter.",
    } as never);
    const res = await as(app, admin)
      .post(`${base}/models/probe`)
      .send({ providerId: "openrouter", modelId: "vendor/missing" });
    expect(res.status).toBe(400);
  });

  it("does not use a key from another workspace to probe", async () => {
    const other = await createUser();
    const otherWs = await createWorkspace(other.id);
    await createWorkspaceAiCredential(otherWs.id, "openrouter");
    const res = await as(app, admin)
      .post(`${base}/models/probe`)
      .send({ providerId: "openrouter", modelId: "vendor/x" });
    expect(res.status).toBe(422);
    expect(vi.mocked(modelProbe.probeModel)).not.toHaveBeenCalled();
  });
});

// ── Caller's own free allowance ─────────────────────────────────────────────

describe("GET /api/ai/me/free-usage", () => {
  it("returns the caller's allowance and the workspaces they administer", async () => {
    const res = await as(app, admin).get("/api/ai/me/free-usage");
    expect(res.status).toBe(200);
    expect(res.body.responseObject).toMatchObject({
      docsLimit: expect.any(Number),
      docsRemaining: expect.any(Number),
      voiceSecondsLimit: expect.any(Number),
    });
    expect(res.body.responseObject.adminWorkspaces.map((w: { id: string }) => w.id)).toEqual([
      workspaceId,
    ]);
  });

  it("lists no administered workspace for a plain member", async () => {
    const res = await as(app, member).get("/api/ai/me/free-usage");
    expect(res.body.responseObject.adminWorkspaces).toEqual([]);
  });
});

// ── The old user-scoped routes are gone ─────────────────────────────────────

describe("removed routes", () => {
  it.each([
    ["get", "/api/ai/status"],
    ["get", "/api/ai/credentials"],
    ["post", "/api/ai/credentials"],
    ["get", "/api/ai/preferences"],
    ["put", "/api/ai/preferences"],
    ["get", "/api/ai/catalog/openrouter"],
    ["post", "/api/ai/models/probe"],
  ] as const)("%s %s answers 404", async (method, url) => {
    const res = await as(app, owner)[method](url).send({});
    expect(res.status).toBe(404);
  });
});
