/**
 * @module api/__tests__/unit/voiceEntitlements
 * @description Voice planning and key resolution for a workspace: the admin
 * switch, the verified-kind rule, the cap, the free-tier seconds, and the
 * guarantee that the key-free planner never carries a plaintext key.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  TEST_AI_KEY,
  closeTestResources,
  createUser,
  createWorkspace,
  createWorkspaceAiCredential,
  createWorkspaceAiPreference,
  resetDatabase,
  testPrisma,
} from "@testhelpers";
import {
  planVoice,
  voiceAvailability,
} from "../../lib/ai/voiceAvailability";
import { resolveVoice } from "../../lib/ai/voiceEntitlements";

const ENV_KEYS = [
  "AI_VOICE_API_KEY",
  "AI_VOICE_BASE_URL",
  "AI_TRANSCRIBE_MODEL",
  "AI_SPEECH_MODEL",
  "AI_SPEECH_VOICE",
  "AI_FREE_VOICE_SECONDS",
] as const;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = process.env[key];

let userId: string;
let workspaceId: string;
const notOver = { isOverCap: async () => false };

beforeEach(async () => {
  await resetDatabase();
  for (const key of ENV_KEYS) delete process.env[key];
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

const withFreeTier = (seconds = "600") => {
  process.env.AI_VOICE_API_KEY = "operator-voice-key";
  process.env.AI_FREE_VOICE_SECONDS = seconds;
};

describe("planVoice", () => {
  it("refuses when the admin switched the assistant off", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text", "transcription"],
    });
    await testPrisma.workspaceAiSettings.create({
      data: { workspaceId, assistantEnabled: false },
    });
    const r = await planVoice({ workspaceId, userId }, notOver);
    expect(r).toMatchObject({ ok: false, reason: "assistant-disabled" });
  });

  it("refuses with no-voice-key when there is neither a verified key nor a free tier", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text"],
    });
    const r = await planVoice({ workspaceId, userId }, notOver);
    expect(r).toMatchObject({ ok: false, reason: "no-voice-key" });
  });

  it("plans on the workspace key when it is verified for transcription", async () => {
    const credential = await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text", "transcription", "speech"],
    });
    const r = await planVoice({ workspaceId, userId }, notOver);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan).toMatchObject({
      source: "byok",
      credentialId: credential.id,
      providerId: "openai",
      transcription: { model: "gpt-4o-mini-transcribe" },
      speech: { model: "gpt-4o-mini-tts" },
    });
  });

  it("omits speech when the key is not verified for it", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["transcription"],
    });
    const r = await planVoice({ workspaceId, userId }, notOver);
    expect(r.ok && r.plan.speech).toBeFalsy();
  });

  it("omits speech when the admin turned spoken replies off", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["transcription", "speech"],
    });
    await testPrisma.workspaceAiSettings.create({
      data: { workspaceId, assistantSpeaks: false },
    });
    const r = await planVoice({ workspaceId, userId }, notOver);
    expect(r.ok && r.plan.speech).toBeFalsy();
  });

  it("honours the saved speech model and voice", async () => {
    await createWorkspaceAiCredential(workspaceId, "openrouter", {
      verifiedKinds: ["transcription", "speech"],
    });
    await createWorkspaceAiPreference(
      workspaceId,
      "SPEECH",
      "openrouter",
      "heygen/heygen-voice-1-turbo:free",
      { voice: "bram" },
    );
    const r = await planVoice({ workspaceId, userId }, notOver);
    expect(r.ok && r.plan.speech).toEqual({
      model: "heygen/heygen-voice-1-turbo:free",
      voice: "bram",
    });
  });

  it("uses the single default voice for a model that takes none", async () => {
    await createWorkspaceAiCredential(workspaceId, "openrouter", {
      verifiedKinds: ["transcription", "speech"],
    });
    const r = await planVoice({ workspaceId, userId }, notOver);
    expect(r.ok && r.plan.speech).toEqual({
      model: "fish-audio/drama-3",
      voice: "default",
    });
  });

  it("refuses with spend-cap-reached when the cap is spent", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["transcription"],
    });
    const r = await planVoice(
      { workspaceId, userId },
      { isOverCap: async () => true },
    );
    expect(r).toMatchObject({ ok: false, reason: "spend-cap-reached" });
  });

  it("falls back to the free tier while the user has seconds left", async () => {
    withFreeTier();
    const r = await planVoice({ workspaceId, userId }, notOver);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan).toMatchObject({
      source: "free",
      transcription: { model: "openai/gpt-transcribe" },
      speech: { model: "fish-audio/drama-3", voice: "default" },
    });
  });

  it("refuses free voice once the user's seconds are spent", async () => {
    withFreeTier("60");
    await testPrisma.user.update({
      where: { id: userId },
      data: { freeVoiceSecondsUsed: 60 },
    });
    const r = await planVoice({ workspaceId, userId }, notOver);
    expect(r).toMatchObject({ ok: false, reason: "free-voice-exhausted" });
  });

  it("never carries a plaintext key or envelope", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["transcription", "speech"],
    });
    const r = await planVoice({ workspaceId, userId }, notOver);
    const text = JSON.stringify(r);
    expect(text).not.toContain(TEST_AI_KEY);
    expect(text).not.toContain("nimbus1.");
  });
});

describe("voiceAvailability", () => {
  it("summarises without a key", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["transcription", "speech"],
    });
    const summary = await voiceAvailability({ workspaceId, userId }, notOver);
    expect(summary).toEqual({ available: true, reason: null, speaks: true });
  });

  it("carries the refusal reason", async () => {
    const summary = await voiceAvailability({ workspaceId, userId }, notOver);
    expect(summary).toEqual({
      available: false,
      reason: "no-voice-key",
      speaks: false,
    });
  });
});

describe("resolveVoice", () => {
  it("decrypts the workspace key for a BYOK plan", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["transcription", "speech"],
    });
    const r = await resolveVoice({ workspaceId, userId }, notOver);
    expect(r).toMatchObject({
      ok: true,
      source: "byok",
      providerId: "openai",
      transcription: {
        apiKey: TEST_AI_KEY,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini-transcribe",
      },
    });
  });

  it("reads the operator's voice key for the free tier", async () => {
    withFreeTier();
    process.env.AI_VOICE_BASE_URL = "https://voice.example.test/v1";
    const r = await resolveVoice({ workspaceId, userId }, notOver);
    expect(r).toMatchObject({
      ok: true,
      source: "free",
      providerId: null,
      transcription: {
        apiKey: "operator-voice-key",
        baseUrl: "https://voice.example.test/v1",
      },
    });
  });

  it("passes a planning refusal through", async () => {
    const r = await resolveVoice({ workspaceId, userId }, notOver);
    expect(r).toMatchObject({ ok: false, reason: "no-voice-key" });
  });

  it("reads an unreadable envelope as no-voice-key", async () => {
    const credential = await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["transcription"],
    });
    const other = await createUser();
    const otherWs = await createWorkspace(other.id);
    await testPrisma.workspaceAiCredential.update({
      where: { id: credential.id },
      data: { workspaceId: otherWs.id },
    });
    const r = await resolveVoice(
      { workspaceId: otherWs.id, userId: other.id },
      notOver,
    );
    expect(r).toMatchObject({ ok: false, reason: "no-voice-key" });
    expect(JSON.stringify(r)).not.toContain(TEST_AI_KEY);
  });
});

describe("planVoice: transcription preference", () => {
  it("honours the saved transcription model on a verified key", async () => {
    await createWorkspaceAiCredential(workspaceId, "openrouter", {
      verifiedKinds: ["transcription"],
    });
    await createWorkspaceAiPreference(
      workspaceId,
      "TRANSCRIPTION",
      "openrouter",
      "openai/gpt-transcribe",
    );
    const r = await planVoice({ workspaceId, userId }, notOver);
    expect(r.ok && r.plan.transcription.model).toBe("openai/gpt-transcribe");
    expect(r.ok && r.plan.providerId).toBe("openrouter");
  });

  it("falls back to a verified key's default when the preferred provider has none", async () => {
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["transcription"],
    });
    await createWorkspaceAiPreference(
      workspaceId,
      "TRANSCRIPTION",
      "openrouter",
      "openai/gpt-transcribe",
    );
    const r = await planVoice({ workspaceId, userId }, notOver);
    expect(r.ok && r.plan.providerId).toBe("openai");
    expect(r.ok && r.plan.transcription.model).toBe("gpt-4o-mini-transcribe");
  });
});
