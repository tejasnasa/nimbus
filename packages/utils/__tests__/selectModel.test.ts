/**
 * @module utils/__tests__/selectModel
 * @description The kind-aware half of model selection: which credential serves
 * which kind of model, and which default each kind gets.
 *
 * A credential limited to some kinds by `verifiedKinds` never serves another,
 * a provider without a kind's models never serves that kind, and the free tier
 * is consulted only when no credential is usable for the feature's kind.
 */
import { describe, expect, it } from "vitest";
import { selectModelForFeature, type CredentialView } from "../src/ai/selectModel";

const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-02-01T00:00:00Z");

const cred = (
  id: string,
  providerId: CredentialView["providerId"],
  verifiedKinds?: CredentialView["verifiedKinds"],
  createdAt = T0,
): CredentialView => ({ id, providerId, createdAt, verifiedKinds });

const FREE = { providerId: "deepseek", modelId: "deepseek-flash" } as const;

describe("selectModelForFeature: kinds", () => {
  it("serves transcription from a credential verified for it, with the provider's default", () => {
    const result = selectModelForFeature(
      "transcription",
      [],
      [cred("c1", "openai", ["transcription"])],
      null,
    );
    expect(result).toMatchObject({
      source: "byok",
      providerId: "openai",
      modelId: "gpt-4o-mini-transcribe",
      credentialId: "c1",
    });
  });

  it("serves speech with the provider's default speech model", () => {
    const result = selectModelForFeature(
      "speech",
      [],
      [cred("c1", "openrouter", ["speech"])],
      null,
    );
    expect(result).toMatchObject({ providerId: "openrouter", modelId: "fish-audio/drama-3" });
  });

  it("refuses chat for a credential that only verified transcription", () => {
    const result = selectModelForFeature(
      "chat",
      [],
      [cred("c1", "openai", ["transcription"])],
      null,
    );
    expect(result).toEqual({ ok: false, reason: "no-key" });
  });

  it("falls to the free tier for chat when the only credential is audio-only", () => {
    const result = selectModelForFeature(
      "chat",
      [],
      [cred("c1", "openai", ["transcription", "speech"])],
      FREE,
    );
    expect(result).toMatchObject({ source: "free", providerId: "deepseek" });
  });

  it("counts a credential with no recorded kinds for every kind its provider has", () => {
    const result = selectModelForFeature("chat", [], [cred("c1", "openai")], null);
    expect(result).toMatchObject({ source: "byok", providerId: "openai" });
    const audio = selectModelForFeature("transcription", [], [cred("c1", "openai")], null);
    expect(audio).toMatchObject({ source: "byok", modelId: "gpt-4o-mini-transcribe" });
  });

  it("never serves audio from a provider that has none, even when verified for it", () => {
    const result = selectModelForFeature(
      "transcription",
      [],
      [cred("c1", "groq", ["text", "transcription"])],
      FREE,
    );
    expect(result).toEqual({ ok: false, reason: "no-capable-model" });
  });

  it("never gives audio to the free tier", () => {
    // The configured free tier is a text model, so it cannot serve speech.
    const result = selectModelForFeature("speech", [], [], FREE);
    expect(result).toMatchObject({ ok: false });
    expect(result).not.toHaveProperty("source");
  });

  it("picks the earliest credential verified for the kind, skipping an earlier one that is not", () => {
    const result = selectModelForFeature(
      "transcription",
      [],
      [
        cred("early", "openai", ["text"], T0),
        cred("late", "openrouter", ["text", "transcription"], T1),
      ],
      null,
    );
    expect(result).toMatchObject({ credentialId: "late", modelId: "openai/gpt-transcribe" });
  });

  it("honours a transcription preference when its credential is verified for the kind", () => {
    const result = selectModelForFeature(
      "transcription",
      [{ feature: "transcription", providerId: "openrouter", modelId: "openai/gpt-transcribe" }],
      [
        cred("a", "openai", ["transcription"], T0),
        cred("b", "openrouter", ["transcription"], T1),
      ],
      null,
    );
    expect(result).toMatchObject({ providerId: "openrouter", credentialId: "b", substituted: false });
  });

  it("ignores a preference whose credential is not verified for the kind", () => {
    const result = selectModelForFeature(
      "transcription",
      [{ feature: "transcription", providerId: "openrouter", modelId: "openai/gpt-transcribe" }],
      [
        cred("a", "openai", ["transcription"], T0),
        cred("b", "openrouter", ["text"], T1),
      ],
      null,
    );
    expect(result).toMatchObject({ providerId: "openai", credentialId: "a" });
  });

  it("serves vision only from a model with vision and jsonMode", () => {
    const groq = selectModelForFeature("vision", [], [cred("g", "groq", ["text"])], null);
    expect(groq).toEqual({ ok: false, reason: "no-capable-model" });
    const deepseek = selectModelForFeature("vision", [], [cred("d", "deepseek", ["text"])], null);
    expect(deepseek).toMatchObject({ providerId: "deepseek", modelId: "deepseek-flash" });
  });
});
