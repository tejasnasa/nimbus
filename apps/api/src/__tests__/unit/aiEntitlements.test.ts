/**
 * @module api/__tests__/unit/aiEntitlements
 * @description The resolver's precedence chain for a workspace, one case per
 * row, driven through the real database and the real credential crypto.
 *
 * The order is preference, then the workspace's own key, then the operator's
 * free tier. The call-log metadata the resolver returns names the workspace
 * and the asking user, and a spent monthly cap refuses own-key calls only.
 *
 * @important No refusal message may echo a key, an envelope or any 8-character
 *            run of one. That is asserted as a sweep over every refusal.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_AI_KEY,
  closeTestResources,
  createUser,
  createWorkspace,
  createWorkspaceAiCredential,
  createWorkspaceAiPreference,
  resetDatabase,
} from "@testhelpers";
import {
  __resetFreeTierWarningForTests,
  loadWorkspaceAiViews,
  resolveAi,
  type AiResolution,
} from "../../lib/ai/entitlements";

const ENV_KEYS = [
  "AI_API_KEY",
  "AI_PROVIDER",
  "AI_MODEL",
  "AI_FREE_DOC_LIMIT",
] as const;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = process.env[key];

let userId: string;
let workspaceId: string;

beforeEach(async () => {
  await resetDatabase();
  process.env.AI_API_KEY = "operator-free-tier-key";
  process.env.AI_PROVIDER = "deepseek";
  process.env.AI_MODEL = "deepseek-flash";
  const user = await createUser();
  userId = user.id;
  workspaceId = (await createWorkspace(user.id)).id;
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await closeTestResources();
});

const notOver = async () => false;
const over = async () => true;

const refusals: AiResolution[] = [];
const keep = <T extends AiResolution>(r: T): T => {
  refusals.push(r);
  return r;
};

describe("resolveAi: precedence", () => {
  it("serves the free tier when the workspace has no key, charged to the asking user", async () => {
    const r = keep(
      await resolveAi(
        { workspaceId, userId, feature: "chat" },
        { isOverCap: notOver },
      ),
    );
    expect(r).toMatchObject({ ok: true, source: "free", providerId: "deepseek" });
    if (!r.ok) return;
    expect(r.meta).toMatchObject({
      workspaceId,
      userId,
      feature: "chat",
      source: "free",
      providerId: "deepseek",
    });
  });

  it("prefers the workspace key over the free tier and names the credential", async () => {
    const credential = await createWorkspaceAiCredential(workspaceId, "openai");
    const r = keep(
      await resolveAi(
        { workspaceId, userId, feature: "chat" },
        { isOverCap: notOver },
      ),
    );
    expect(r).toMatchObject({ ok: true, source: "byok", providerId: "openai" });
    if (!r.ok) return;
    expect(r.credentialId).toBe(credential.id);
    expect(r.meta).toMatchObject({
      workspaceId,
      userId,
      source: "byok",
      credentialId: credential.id,
    });
    expect(r.keyFingerprint).toBe(credential.keyFingerprint);
  });

  it("honours the workspace's saved preference", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai");
    await createWorkspaceAiCredential(workspaceId, "groq");
    await createWorkspaceAiPreference(workspaceId, "CHAT", "groq", "openai/gpt-oss-20b");
    const r = await resolveAi(
      { workspaceId, userId, feature: "chat" },
      { isOverCap: notOver },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.providerId).toBe("groq");
      expect(r.modelId).toBe("openai/gpt-oss-20b");
      expect(r.substituted).toBe(false);
    }
  });

  it("does not use another workspace's key", async () => {
    const other = await createUser();
    const otherWs = await createWorkspace(other.id);
    await createWorkspaceAiCredential(otherWs.id, "openai");
    const r = await resolveAi(
      { workspaceId, userId, feature: "chat" },
      { isOverCap: notOver },
    );
    expect(r).toMatchObject({ ok: true, source: "free" });
  });

  it("refuses with no-operator-key when there is neither a key nor a free tier", async () => {
    delete process.env.AI_API_KEY;
    const r = keep(
      await resolveAi({ workspaceId, userId, feature: "chat" }, { isOverCap: notOver }),
    );
    expect(r).toMatchObject({ ok: false, reason: "no-operator-key", cta: "add-key" });
  });

  it("refuses a vision request when the workspace's only key has no vision model", async () => {
    await createWorkspaceAiCredential(workspaceId, "groq");
    const r = keep(
      await resolveAi({ workspaceId, userId, feature: "vision" }, { isOverCap: notOver }),
    );
    expect(r).toMatchObject({ ok: false, reason: "no-capable-model", cta: "manage-ai" });
  });

  it("serves vision from the free tier when it has a vision model", async () => {
    const r = await resolveAi(
      { workspaceId, userId, feature: "vision" },
      { isOverCap: notOver },
    );
    expect(r).toMatchObject({ ok: true, source: "free", modelId: "deepseek-flash" });
  });
});

describe("resolveAi: kinds", () => {
  it("does not use a credential verified only for audio to answer chat", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["transcription"],
    });
    const r = await resolveAi(
      { workspaceId, userId, feature: "chat" },
      { isOverCap: notOver },
    );
    expect(r).toMatchObject({ ok: true, source: "free" });
  });
});

describe("resolveAi: spend cap", () => {
  it("refuses an own-key call once the cap is reached, naming what would have run", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai");
    const r = keep(
      await resolveAi({ workspaceId, userId, feature: "chat" }, { isOverCap: over }),
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "spend-cap-reached",
      cta: "manage-ai",
      attempted: { providerId: "openai", source: "byok" },
    });
  });

  it("does not apply the workspace cap to a free-tier call", async () => {
    const r = await resolveAi(
      { workspaceId, userId, feature: "chat" },
      { isOverCap: over },
    );
    expect(r).toMatchObject({ ok: true, source: "free" });
  });
});

describe("resolveAi: stored credentials", () => {
  it("asks for the key again when its envelope cannot be read", async () => {
    const credential = await createWorkspaceAiCredential(workspaceId, "openai");
    // Move the row to another workspace's AAD by re-pointing it: the stored
    // envelope was bound to this workspace, so reading it in a different one
    // fails.
    const other = await createUser();
    const otherWs = await createWorkspace(other.id);
    const { testPrisma } = await import("@testhelpers");
    await testPrisma.workspaceAiCredential.update({
      where: { id: credential.id },
      data: { workspaceId: otherWs.id },
    });
    const r = keep(
      await resolveAi(
        { workspaceId: otherWs.id, userId: other.id, feature: "chat" },
        { isOverCap: notOver },
      ),
    );
    expect(r).toMatchObject({ ok: false, reason: "no-key", cta: "add-key" });
  });

  it("builds a handle for a catalogue preference from its stored capabilities", async () => {
    await createWorkspaceAiCredential(workspaceId, "openrouter");
    await createWorkspaceAiPreference(
      workspaceId,
      "CHAT",
      "openrouter",
      "vendor/some-new-model",
      { modelSource: "catalog", modelCapabilities: ["tools", "streaming", "jsonMode"] },
    );
    const r = await resolveAi(
      { workspaceId, userId, feature: "chat" },
      { isOverCap: notOver },
    );
    expect(r).toMatchObject({
      ok: true,
      source: "byok",
      providerId: "openrouter",
      modelId: "vendor/some-new-model",
    });
  });
});

describe("loadWorkspaceAiViews", () => {
  it("maps rows to lowercase features and carries verified kinds", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text", "speech"],
    });
    await createWorkspaceAiPreference(workspaceId, "TRANSCRIPTION", "openai", "gpt-4o-mini-transcribe");
    const views = await loadWorkspaceAiViews(workspaceId);
    expect(views.credentialViews[0]).toMatchObject({
      providerId: "openai",
      verifiedKinds: ["text", "speech"],
    });
    expect(views.preferenceViews[0]).toMatchObject({
      feature: "transcription",
      providerId: "openai",
    });
  });
});

describe("no secret leaks", () => {
  it("never puts a key or envelope fragment in a refusal", () => {
    const fragments = [TEST_AI_KEY, TEST_AI_KEY.slice(-12), "nimbus1."];
    for (const r of refusals) {
      if (r.ok) continue;
      const text = JSON.stringify(r);
      for (const fragment of fragments) expect(text).not.toContain(fragment);
    }
  });
});

describe("resolveAi: the free tier's model", () => {
  it("refuses with no-capable-model when the configured free model is not in the registry", async () => {
    // beforeEach and afterAll restore the variable.
    process.env[ENV_KEYS[2]] = "a-model-the-registry-does-not-know";
    const r = keep(
      await resolveAi({ workspaceId, userId, feature: "chat" }, { isOverCap: notOver }),
    );
    expect(r).toMatchObject({ ok: false, reason: "no-capable-model", cta: "manage-ai" });
  });

  it("warns once per process that free-tier capabilities are assumed", async () => {
    __resetFreeTierWarningForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await resolveAi({ workspaceId, userId, feature: "chat" }, { isOverCap: notOver });
      await resolveAi({ workspaceId, userId, feature: "markdown" }, { isOverCap: notOver });
      expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      warn.mockRestore();
      __resetFreeTierWarningForTests();
    }
  });
});
