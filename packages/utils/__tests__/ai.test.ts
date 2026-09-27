/**
 * @module utils/__tests__/ai
 * @description Pure-logic tests for the AI provider registry predicates and the
 * `selectModelForFeature` precedence resolver.
 *
 * The registry is data: every test that pins its shape is here. The selector
 * is pure: no DB, no env, no logger — table-driven cases can pin every branch
 * of the precedence chain in `byok_plan.md` §5 without spinning up Postgres.
 *
 * @important The fixtures here must stay in lockstep with the registry in
 *            `packages/types/src/ai/providers.ts`. If a provider is added,
 *            a test below should pin its capabilities, not silently inherit
 *            the data — the Phase 0 probe (`apps/api/scripts/probe_ai_providers.ts`)
 *            is what makes those capabilities trustworthy.
 */

import { describe, expect, it } from "vitest";
import {
  AI_FEATURE_RECOMMENDED,
  AI_FEATURE_REQUIREMENTS,
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  meetsRequirements,
  modelById,
  modelsFor,
  type AiFeature,
  type AiModelSpec,
  type AiProviderSpec,
} from "@nimbus/types";

import {
  isOfferedFor,
  selectModelForFeature,
  type CredentialView,
  type FreeTierView,
  type PreferenceView,
} from "../src/ai/selectModel";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A credential id is opaque, but the selector's tie-breaker on equal `createdAt` is alphabetical. */
const cred = (
  id: string,
  providerId: string,
  createdAt: Date,
): CredentialView => ({
  id,
  providerId,
  createdAt,
});

const pref = (
  feature: AiFeature,
  providerId: string,
  modelId: string,
): PreferenceView => ({ feature, providerId, modelId });

const free = (providerId: string, modelId: string): FreeTierView => ({
  providerId,
  modelId,
});

const openaiGpt5Nano = (): AiModelSpec => {
  const m = modelById(AI_PROVIDERS.openai, "gpt-5-nano");
  if (!m) throw new Error("fixture: registry missing openai/gpt-5-nano");
  return m;
};

const groqGptOss120 = (): AiModelSpec => {
  const m = modelById(AI_PROVIDERS.groq, "openai/gpt-oss-120b");
  if (!m) throw new Error("fixture: registry missing groq/openai/gpt-oss-120b");
  return m;
};

const groqQwen = (): AiModelSpec => {
  const m = modelById(AI_PROVIDERS.groq, "qwen/qwen3.8-27b");
  if (!m) throw new Error("fixture: registry missing groq/qwen/qwen3.8-27b");
  return m;
};

const deepseekFlash = (): AiModelSpec => {
  const m = modelById(AI_PROVIDERS.deepseek, "deepseek-flash");
  if (!m) throw new Error("fixture: registry missing deepseek/deepseek-flash");
  return m;
};

// ── meetsRequirements — per-capability-combination truth table ──────────────

describe("meetsRequirements — feature-by-feature truth table", () => {
  it("chat requires only `tools`", () => {
    expect(AI_FEATURE_REQUIREMENTS.chat).toEqual(["tools"]);

    expect(meetsRequirements(openaiGpt5Nano(), "chat")).toBe(true);
    expect(meetsRequirements(deepseekFlash(), "chat")).toBe(true);
    // Reasoning capability is irrelevant — `reasoning` is recommended, not required.
    expect(meetsRequirements(groqQwen(), "chat")).toBe(true);
  });

  it("markdown requires only `streaming`", () => {
    expect(AI_FEATURE_REQUIREMENTS.markdown).toEqual(["streaming"]);

    expect(meetsRequirements(openaiGpt5Nano(), "markdown")).toBe(true);
    expect(meetsRequirements(groqQwen(), "markdown")).toBe(true);
    expect(meetsRequirements(deepseekFlash(), "markdown")).toBe(true);
  });

  it("canvas requires `streaming` AND `jsonMode`", () => {
    expect(AI_FEATURE_REQUIREMENTS.canvas).toEqual(["streaming", "jsonMode"]);

    expect(meetsRequirements(openaiGpt5Nano(), "canvas")).toBe(true);
    expect(meetsRequirements(deepseekFlash(), "canvas")).toBe(true);
    // Groq's qwen model is registered with both streaming and jsonMode, so it
    // meets canvas requirements regardless of the reasoning gap.
    expect(meetsRequirements(groqQwen(), "canvas")).toBe(true);
  });

  it("returns false when a required capability is missing — synthetic model", () => {
    // A model without `tools` cannot do chat.
    const noTools: AiModelSpec = {
      id: "no-tools",
      label: "No-tools model",
      capabilities: ["streaming", "jsonMode", "reasoning"],
      effortLevels: ["low"],
    };
    expect(meetsRequirements(noTools, "chat")).toBe(false);
    expect(meetsRequirements(noTools, "markdown")).toBe(true);
    expect(meetsRequirements(noTools, "canvas")).toBe(true);

    // A model without `jsonMode` cannot do canvas.
    const noJson: AiModelSpec = {
      id: "no-json",
      label: "No-json model",
      capabilities: ["tools", "streaming", "reasoning"],
      effortLevels: ["low"],
    };
    expect(meetsRequirements(noJson, "chat")).toBe(true);
    expect(meetsRequirements(noJson, "markdown")).toBe(true);
    expect(meetsRequirements(noJson, "canvas")).toBe(false);

    // A model without `streaming` cannot do either markdown or canvas.
    const noStream: AiModelSpec = {
      id: "no-stream",
      label: "No-stream model",
      capabilities: ["tools", "jsonMode"],
      effortLevels: [],
    };
    expect(meetsRequirements(noStream, "chat")).toBe(true);
    expect(meetsRequirements(noStream, "markdown")).toBe(false);
    expect(meetsRequirements(noStream, "canvas")).toBe(false);
  });

  it("treats every required capability as a hard conjunction, not a disjunction", () => {
    // A model meeting only one of the canvas requirements must still fail.
    const onlyStream: AiModelSpec = {
      id: "only-stream",
      label: "Streaming-only",
      capabilities: ["streaming"],
      effortLevels: [],
    };
    expect(meetsRequirements(onlyStream, "canvas")).toBe(false);

    const onlyJson: AiModelSpec = {
      id: "only-json",
      label: "JSON-only",
      capabilities: ["jsonMode"],
      effortLevels: [],
    };
    expect(meetsRequirements(onlyJson, "canvas")).toBe(false);
  });
});

describe("modelsFor — picker filter", () => {
  it("returns the registry order, not capability order", () => {
    const groq = AI_PROVIDERS.groq;
    const offered = modelsFor(groq, "canvas");
    // Every offered model must meet requirements; registry order is preserved.
    expect(offered.map((m) => m.id)).toEqual([
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
    ]);
  });

  it("filters out a model that cannot do canvas — custom-model-cannot-do-canvas", () => {
    // A minimal registry with one capable model and one incapable model.
    const custom: Record<string, AiProviderSpec> = {
      acme: {
        id: "acme",
        label: "Acme",
        baseUrl: "https://acme.example/v1",
        docsUrl: "https://acme.example/docs",
        keyUrl: "https://acme.example/keys",
        defaultModel: "acme-1",
        supportsReasoning: false,
        models: [
          {
            id: "acme-1",
            label: "Acme 1",
            capabilities: ["tools", "streaming"],
            effortLevels: [],
          },
          {
            id: "acme-no-json",
            label: "Acme No-JSON",
            capabilities: ["tools", "streaming"],
            effortLevels: [],
          },
        ],
        verifiedAt: "2026-09-27",
      },
    };

    expect(modelsFor(custom.acme!, "canvas")).toEqual([]);
    // But chat (tools only) accepts both.
    expect(
      modelsFor(custom.acme!, "chat")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["acme-1", "acme-no-json"]);
  });
});

// ── selectModelForFeature — precedence chain ─────────────────────────────────

describe("selectModelForFeature — precedence chain", () => {
  it("step 1: a matching preference + credential returns BYOK on the chosen model", () => {
    const result = selectModelForFeature(
      "chat",
      [pref("chat", "openai", "gpt-5-nano")],
      [cred("c1", "openai", new Date("2026-01-01T00:00:00Z"))],
      null,
    );

    expect(result).toEqual({
      ok: true,
      source: "byok",
      providerId: "openai",
      modelId: "gpt-5-nano",
      credentialId: "c1",
      substituted: false,
    });
  });

  it("step 1: a preference for a feature that the saved model cannot do is substituted with the provider default", () => {
    // A synthetic registry where the saved preference names a model that
    // cannot do canvas, but the provider's default can. The selector must
    // recognise the capability mismatch and fall through to step 3 *within
    // the same provider*.
    const custom: Record<string, AiProviderSpec> = {
      acme: {
        id: "acme",
        label: "Acme",
        baseUrl: "https://acme.example/v1",
        docsUrl: "",
        keyUrl: "",
        defaultModel: "acme-canvas",
        supportsReasoning: false,
        models: [
          {
            // User saved this for canvas, but it lacks jsonMode — so the
            // preference is unusable and we must substitute.
            id: "acme-chat-only",
            label: "Acme Chat",
            capabilities: ["tools", "streaming"],
            effortLevels: [],
          },
          {
            id: "acme-canvas",
            label: "Acme Canvas",
            capabilities: ["tools", "streaming", "jsonMode"],
            effortLevels: [],
          },
        ],
        verifiedAt: "2026-09-27",
      },
    };

    const result = selectModelForFeature(
      "canvas",
      [pref("canvas", "acme", "acme-chat-only")],
      [cred("c1", "acme", new Date("2026-01-01T00:00:00Z"))],
      null,
      custom,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Falls through to step 3 *within the same provider*. The provider is
      // still acme (no other credential exists); the model is the provider's
      // default. `substituted` is true because the preference was set but not
      // honoured.
      expect(result.source).toBe("byok");
      expect(result.providerId).toBe("acme");
      expect(result.modelId).toBe("acme-canvas");
      expect(result.credentialId).toBe("c1");
      expect(result.substituted).toBe(true);
    }
  });

  it("step 2: a preference whose credential was deleted falls through to the primary credential", () => {
    // The user saved a preference for OpenAI but their OpenAI credential is
    // gone; they still have a Groq credential. Step 2 says "don't refuse".
    const result = selectModelForFeature(
      "chat",
      [pref("chat", "openai", "gpt-5-nano")],
      [cred("c-groq", "groq", new Date("2026-02-01T00:00:00Z"))],
      null,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("byok");
      expect(result.providerId).toBe("groq");
      expect(result.credentialId).toBe("c-groq");
    }
  });

  it("step 3: the primary credential is the earliest `createdAt`, then lexicographic `id`", () => {
    // Three credentials, the middle one by date is the latest by id — `id`
    // must be the tie-breaker, not `providerId`.
    const result = selectModelForFeature(
      "chat",
      [],
      [
        cred("c-late", "deepseek", new Date("2026-03-01T00:00:00Z")),
        cred("c-early", "openai", new Date("2026-01-01T00:00:00Z")),
        cred("c-mid-by-id", "groq", new Date("2026-02-01T00:00:00Z")),
      ],
      null,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credentialId).toBe("c-early");
      expect(result.providerId).toBe("openai");
    }
  });

  it("step 3: when two credentials share `createdAt`, `id` breaks the tie deterministically", () => {
    const sameTime = new Date("2026-01-01T00:00:00Z");
    const result = selectModelForFeature(
      "chat",
      [],
      [
        cred("zzz", "deepseek", sameTime),
        cred("aaa", "groq", sameTime),
        cred("mmm", "openai", sameTime),
      ],
      null,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credentialId).toBe("aaa");
    }
  });

  it("step 3: tries the next credential when the primary's default model lacks a required capability", () => {
    // A synthetic registry where openai's default model has no tools (so chat
    // refuses it), and groq's default has tools. Primary is openai by date.
    const custom: Record<string, AiProviderSpec> = {
      openai: {
        id: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        docsUrl: "",
        keyUrl: "",
        defaultModel: "openai-no-tools",
        supportsReasoning: false,
        models: [
          {
            id: "openai-no-tools",
            label: "No Tools",
            capabilities: ["streaming", "jsonMode"],
            effortLevels: [],
          },
        ],
        verifiedAt: "2026-09-27",
      },
      groq: {
        id: "groq",
        label: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        docsUrl: "",
        keyUrl: "",
        defaultModel: "groq-with-tools",
        supportsReasoning: false,
        models: [
          {
            id: "groq-with-tools",
            label: "With Tools",
            capabilities: ["tools", "streaming"],
            effortLevels: [],
          },
        ],
        verifiedAt: "2026-09-27",
      },
    };

    const result = selectModelForFeature(
      "chat",
      [],
      [
        cred("c-openai", "openai", new Date("2026-01-01T00:00:00Z")),
        cred("c-groq", "groq", new Date("2026-02-01T00:00:00Z")),
      ],
      null,
      custom,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credentialId).toBe("c-groq");
      expect(result.providerId).toBe("groq");
      expect(result.modelId).toBe("groq-with-tools");
    }
  });

  it("step 4: a user with credentials never consumes the free tier (decision 9)", () => {
    const result = selectModelForFeature(
      "chat",
      [],
      [cred("c1", "deepseek", new Date("2026-01-01T00:00:00Z"))],
      free("deepseek", "deepseek-flash"),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("byok");
      expect(result.providerId).toBe("deepseek");
    }
  });

  it("step 4: the free tier is used only when there are no credentials", () => {
    const result = selectModelForFeature(
      "chat",
      [],
      [],
      free("deepseek", "deepseek-flash"),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("free");
      expect(result.providerId).toBe("deepseek");
      expect(result.modelId).toBe("deepseek-flash");
      expect(result.credentialId).toBeNull();
      expect(result.substituted).toBe(false);
    }
  });

  it("step 5: refuses with `no-key` when there is no credential and no free tier", () => {
    const result = selectModelForFeature("chat", [], [], null);
    expect(result).toEqual({ ok: false, reason: "no-key" });
  });

  it("step 5: refuses with `no-capable-model` when every credential's default model fails the feature", () => {
    // Both credentials' defaults lack jsonMode — canvas refuses.
    const custom: Record<string, AiProviderSpec> = {
      a: {
        id: "a",
        label: "A",
        baseUrl: "https://a.example/v1",
        docsUrl: "",
        keyUrl: "",
        defaultModel: "a-stream-only",
        supportsReasoning: false,
        models: [
          {
            id: "a-stream-only",
            label: "A stream only",
            capabilities: ["streaming"],
            effortLevels: [],
          },
        ],
        verifiedAt: "2026-09-27",
      },
      b: {
        id: "b",
        label: "B",
        baseUrl: "https://b.example/v1",
        docsUrl: "",
        keyUrl: "",
        defaultModel: "b-stream-only",
        supportsReasoning: false,
        models: [
          {
            id: "b-stream-only",
            label: "B stream only",
            capabilities: ["streaming"],
            effortLevels: [],
          },
        ],
        verifiedAt: "2026-09-27",
      },
    };

    const result = selectModelForFeature(
      "canvas",
      [],
      [
        cred("c-a", "a", new Date("2026-01-01T00:00:00Z")),
        cred("c-b", "b", new Date("2026-02-01T00:00:00Z")),
      ],
      null,
      custom,
    );

    expect(result).toEqual({ ok: false, reason: "no-capable-model" });
  });

  it("step 5: refuses with `no-capable-model` when the free-tier model fails the feature", () => {
    const custom: Record<string, AiProviderSpec> = {
      tiny: {
        id: "tiny",
        label: "Tiny",
        baseUrl: "https://tiny.example/v1",
        docsUrl: "",
        keyUrl: "",
        defaultModel: "tiny-1",
        supportsReasoning: false,
        models: [
          {
            id: "tiny-1",
            label: "Tiny 1",
            // streaming only — canvas requires streaming + jsonMode.
            capabilities: ["streaming"],
            effortLevels: [],
          },
        ],
        verifiedAt: "2026-09-27",
      },
    };

    const result = selectModelForFeature(
      "canvas",
      [],
      [],
      free("tiny", "tiny-1"),
      custom,
    );

    expect(result).toEqual({ ok: false, reason: "no-capable-model" });
  });
});

// ── selectModelForFeature — robustness ───────────────────────────────────────

describe("selectModelForFeature — unknown provider / model robustness", () => {
  it("ignores a preference for an unknown provider and falls through to the primary credential", () => {
    // A stale row from before a registry change. Step 1 must not refuse —
    // it must silently step to step 3.
    const result = selectModelForFeature(
      "chat",
      [pref("chat", "retired-provider" as AiProviderSpec["id"], "model-x")],
      [cred("c-groq", "groq", new Date("2026-01-01T00:00:00Z"))],
      null,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.providerId).toBe("groq");
      expect(result.credentialId).toBe("c-groq");
    }
  });

  it("ignores a preference for an unknown model on a known provider", () => {
    // The user saved a model id that the registry no longer carries.
    const result = selectModelForFeature(
      "chat",
      [pref("chat", "openai", "retired-gpt-3.5")],
      [cred("c1", "openai", new Date("2026-01-01T00:00:00Z"))],
      null,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.providerId).toBe("openai");
      // Fell through to step 3 — provider default.
      expect(result.modelId).toBe(AI_PROVIDERS.openai.defaultModel);
      expect(result.substituted).toBe(true);
    }
  });

  it("ignores a credential whose providerId is not in the registry", () => {
    const result = selectModelForFeature(
      "chat",
      [],
      [
        cred(
          "c-stale",
          "retired" as AiProviderSpec["id"],
          new Date("2026-01-01T00:00:00Z"),
        ),
        cred("c-groq", "groq", new Date("2026-02-01T00:00:00Z")),
      ],
      null,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.providerId).toBe("groq");
      expect(result.credentialId).toBe("c-groq");
    }
  });

  it("uses the free tier only when every credential is for an unknown provider", () => {
    const result = selectModelForFeature(
      "chat",
      [],
      [
        cred(
          "c-stale",
          "retired" as AiProviderSpec["id"],
          new Date("2026-01-01T00:00:00Z"),
        ),
      ],
      free("deepseek", "deepseek-flash"),
    );

    // No known-byok credential → step 4 fires (decision 9 reads "no credentials
    // at all" — a stale credential pointing at a provider that no longer
    // exists is treated the same way: it cannot serve a request).
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("free");
      expect(result.providerId).toBe("deepseek");
    }
  });

  it("skips a credential whose provider is missing from the supplied registry", () => {
    // Pins the inner `if (!provider) continue;` branch: the inner loop must
    // drop stale credentials even if `usableCredentials` is empty for them
    // (the outer filter handles the no-usable-credentials case, but the inner
    // check is the actual skip path when a custom registry omits a provider).
    const custom: Record<string, AiProviderSpec> = {
      openai: {
        id: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        docsUrl: "",
        keyUrl: "",
        defaultModel: "gpt-5-nano",
        supportsReasoning: false,
        models: [
          {
            id: "gpt-5-nano",
            label: "GPT-5 Nano",
            capabilities: ["tools", "streaming"],
            effortLevels: [],
          },
        ],
        verifiedAt: "2026-09-27",
      },
    };
    const result = selectModelForFeature(
      "chat",
      [],
      [
        // Provider not in the custom registry.
        cred("c-groq", "groq", new Date("2026-01-01T00:00:00Z")),
        cred("c-openai", "openai", new Date("2026-02-01T00:00:00Z")),
      ],
      null,
      custom,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.providerId).toBe("openai");
      expect(result.credentialId).toBe("c-openai");
    }
  });

  it("refuses with no-capable-model when the free-tier provider is unknown", () => {
    // The free tier is configured but its provider is not in the registry —
    // it cannot be used. With no credentials, the only honest answer is a
    // refusal: no-key would mislead the operator, since a free tier is
    // nominally configured.
    const result = selectModelForFeature(
      "chat",
      [],
      [],
      free("retired" as AiProviderSpec["id"], "model-x"),
    );

    expect(result).toEqual({ ok: false, reason: "no-capable-model" });
  });
});

// ── isOfferedFor — picker helper ─────────────────────────────────────────────

describe("isOfferedFor — picker enable/disable", () => {
  it("returns true for a registered model that meets the feature's hard requirements", () => {
    expect(isOfferedFor(AI_PROVIDERS.openai, "gpt-5-nano", "chat")).toBe(true);
    expect(
      isOfferedFor(AI_PROVIDERS.deepseek, "deepseek-flash", "canvas"),
    ).toBe(true);
  });

  it("returns false for an unknown model id on a known provider", () => {
    expect(isOfferedFor(AI_PROVIDERS.openai, "gpt-9000", "chat")).toBe(false);
  });

  it("returns false for a registered model that fails the feature's hard requirements", () => {
    // Hypothetical: a model registered without tools is not offered for chat.
    const noTools: AiProviderSpec = {
      id: "no-tools-co",
      label: "No Tools Co",
      baseUrl: "https://nt.example/v1",
      docsUrl: "",
      keyUrl: "",
      defaultModel: "nt-1",
      supportsReasoning: false,
      models: [
        {
          id: "nt-1",
          label: "NT 1",
          capabilities: ["streaming", "jsonMode"],
          effortLevels: [],
        },
      ],
      verifiedAt: "2026-09-27",
    };
    expect(isOfferedFor(noTools, "nt-1", "chat")).toBe(false);
    expect(isOfferedFor(noTools, "nt-1", "markdown")).toBe(true);
    expect(isOfferedFor(noTools, "nt-1", "canvas")).toBe(true);
  });
});

// ── AI_FEATURE_REQUIREMENTS ∩ AI_FEATURE_RECOMMENDED = ∅ ────────────────────

describe("requirements and recommended are disjoint", () => {
  // The plan §1 calls this out: if a capability is in both lists, the
  // picker's "hard filter / soft warn" split is meaningless. This test pins
  // the invariant for the current registry so a future capability addition
  // is forced to make the choice consciously.
  it.each(AI_PROVIDER_IDS.map((id) => [id]))(
    "%s provider is registered",
    (id) => {
      expect(AI_PROVIDERS[id]).toBeDefined();
    },
  );

  it.each([["chat"], ["markdown"], ["canvas"]] as const)(
    "`%s` hard and soft requirements do not overlap",
    (feature: AiFeature) => {
      const required = new Set<string>(AI_FEATURE_REQUIREMENTS[feature]);
      const recommended = new Set<string>(AI_FEATURE_RECOMMENDED[feature]);
      for (const cap of recommended) {
        expect(required.has(cap)).toBe(false);
      }
    },
  );
});
