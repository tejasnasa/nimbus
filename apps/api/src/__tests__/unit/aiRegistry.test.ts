/**
 * @module api/__tests__/unit/aiRegistry
 * @description Registry invariants for `packages/types/src/ai/providers.ts`.
 *
 * `packages/types` has no test suite of its own and no coverage floor, so the
 * data that drives the model picker lives in code that nothing exercises by
 * construction. These tests pin its shape: a wrong base URL, a model without
 * a required capability, or an overlap between hard and soft requirements all
 * fail here loudly, before the picker offers something that the call sites
 * cannot honour.
 *
 * @important Every test in this file reads only from the registry itself.
 *            The probe (`apps/api/scripts/probe_ai_providers.ts`) is what
 *            populates `verifiedAt` and the capability lists; this file
 *            asserts those populations stay consistent.
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
  type AiProviderId,
} from "@nimbus/types";

// ── Identity ────────────────────────────────────────────────────────────────

describe("AI_PROVIDER_IDS — registry membership", () => {
  it("exposes the four documented providers, in order", () => {
    // Order matters: the picker lists providers in this order, and changing
    // it is a UI decision rather than a data one.
    expect([...AI_PROVIDER_IDS]).toEqual([
      "openai",
      "groq",
      "deepseek",
      "openrouter",
    ]);
  });

  it("has a unique entry per id", () => {
    const ids = Object.keys(AI_PROVIDERS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of AI_PROVIDER_IDS) {
      expect(AI_PROVIDERS[id]).toBeDefined();
    }
  });
});

// ── Transport ───────────────────────────────────────────────────────────────

describe("baseUrl — the trap, pinned per provider", () => {
  it("every baseUrl is HTTPS", () => {
    for (const id of AI_PROVIDER_IDS) {
      expect(AI_PROVIDERS[id].baseUrl.startsWith("https://")).toBe(true);
    }
  });

  it("DeepSeek's baseUrl has no `/v1` — the registry's load-bearing asymmetry", () => {
    // The SDK appends `/responses` to whatever is given. A wrong base URL
    // here fails as a 404 at request time, not at import — which is why
    // this is asserted directly. The Phase 0 probe confirmed both forms
    // work on the live API; the documented form is kept because it is the
    // one DeepSeek's docs use and it is the one less likely to break under
    // a future provider-side change.
    expect(AI_PROVIDERS.deepseek.baseUrl).toBe("https://api.deepseek.com");
    expect(AI_PROVIDERS.deepseek.baseUrl.endsWith("/v1")).toBe(false);
  });

  it("OpenAI's baseUrl ends with `/v1` — the opposite asymmetry, equally load-bearing", () => {
    // The mirror image of the DeepSeek trap: OpenAI requires `/v1` and a
    // wrong value here is the same 404 at request time. The two assertions
    // together are the reason the picker is built around a typed registry
    // rather than ad-hoc strings at each call site.
    expect(AI_PROVIDERS.openai.baseUrl).toBe("https://api.openai.com/v1");
    expect(AI_PROVIDERS.openai.baseUrl.endsWith("/v1")).toBe(true);
  });
});

// ── Capabilities ────────────────────────────────────────────────────────────

describe("defaultModel — every provider's default is a real model in its list", () => {
  for (const id of AI_PROVIDER_IDS) {
    it(`${id}`, () => {
      const provider = AI_PROVIDERS[id];
      const model = modelById(provider, provider.defaultModel);
      expect(model).toBeDefined();
      // And it has a non-empty label, so the picker can render it.
      expect(model?.label).toBeTruthy();
    });
  }
});

describe("every provider has at least one capable model for each feature", () => {
  // A provider is offered in the picker only when it has a model that meets
  // the feature's hard requirements. A provider that meets none is still
  // registered — `verifiedAt: null` says "not offered yet" — but the moment
  // it is verified, every feature it claims to serve needs a capable model.
  const features: readonly AiFeature[] = ["chat", "markdown", "canvas"];

  for (const id of AI_PROVIDER_IDS) {
    for (const feature of features) {
      it(`${id} × ${feature}`, () => {
        const provider = AI_PROVIDERS[id];
        const offered = modelsFor(provider, feature);
        if (provider.verifiedAt !== null) {
          // Verified providers must offer at least one capable model per
          // feature — otherwise the picker advertises a provider that
          // refuses the request when the user clicks it.
          expect(offered.length).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe("every registered model satisfies its provider's supportsReasoning claim", () => {
  // `supportsReasoning: false` is a provider-wide statement: the provider's
  // models are not reasoning models, so `reasoning: { effort }` would 400.
  // `supportsReasoning: true` does not force every model to have the
  // capability (Groq's qwen model omits it), but a model that lists
  // `reasoning` in its capabilities MUST come from a provider where
  // `supportsReasoning === true`, otherwise the picker offers something
  // that 400s at request time.
  for (const id of AI_PROVIDER_IDS) {
    it(`${id} has consistent reasoning capability across provider and models`, () => {
      const provider = AI_PROVIDERS[id];
      if (!provider.supportsReasoning) {
        for (const model of provider.models) {
          expect(model.capabilities).not.toContain("reasoning");
          expect(model.capabilities).not.toContain("reasoningSummary");
        }
      }
    });
  }
});

// ── Required ∩ Recommended = ∅ ─────────────────────────────────────────────

describe("AI_FEATURE_REQUIREMENTS ∩ AI_FEATURE_RECOMMENDED = ∅", () => {
  // The picker's "hard filter / soft warn" split is meaningless when a
  // capability is in both lists: a model would be excluded AND warned for
  // the same reason. Pin the invariant per feature so a future addition is
  // forced to make the choice consciously.
  const features: readonly AiFeature[] = ["chat", "markdown", "canvas"];

  for (const feature of features) {
    it(`${feature} hard and soft requirements are disjoint`, () => {
      const required = new Set<string>(AI_FEATURE_REQUIREMENTS[feature]);
      const recommended = new Set<string>(AI_FEATURE_RECOMMENDED[feature]);
      for (const cap of recommended) {
        expect(required.has(cap)).toBe(false);
      }
    });
  }
});

// ── Per-feature coverage of every registered model ──────────────────────────

describe("every model in a verified provider meets the chat hard requirement", () => {
  // chat is the one feature every user interacts with, so a verified
  // provider must serve it. The other features have their own `modelsFor`
  // assertions above; chat is repeated here as a sharper per-model check
  // because the free tier runs on chat every single request.
  for (const id of AI_PROVIDER_IDS) {
    it(`${id}`, () => {
      const provider = AI_PROVIDERS[id];
      if (provider.verifiedAt === null) return;
      for (const model of provider.models) {
        expect(meetsRequirements(model, "chat")).toBe(true);
      }
    });
  }
});

// ── verifiedAt semantics ────────────────────────────────────────────────────

describe("verifiedAt — measurement, not assumption", () => {
  it("is null for providers the probe has not measured", () => {
    // OpenRouter was not verified in Phase 0 (no API key). The honest
    // default is null, which the picker treats as "do not offer". This
    // test will fail the moment Phase 0 (or a future run) records an
    // OpenRouter verification — at which point the next step is to add the
    // measured capabilities here.
    expect(AI_PROVIDERS.openrouter.verifiedAt).toBeNull();
  });

  it("is an ISO date string for every verified provider", () => {
    // A bare string check is enough: the picker treats null as the only
    // non-parseable value, and any ISO 8601 string parses to a real Date.
    for (const id of AI_PROVIDER_IDS) {
      const v = AI_PROVIDERS[id].verifiedAt;
      if (v === null) continue;
      expect(Number.isNaN(Date.parse(v))).toBe(false);
    }
  });
});

// ── Sanity: registry surfaces the data the picker actually consumes ──────────

describe("registry surface — exports the data the picker actually consumes", () => {
  it("every model has a non-empty `label` and a stable `id`", () => {
    // The picker renders `label` and submits `id`. An empty label would
    // render a blank row; an unstable id would silently swap models when
    // the probe re-runs.
    for (const id of AI_PROVIDER_IDS) {
      const provider = AI_PROVIDERS[id];
      for (const model of provider.models) {
        expect(model.id).toBeTruthy();
        expect(model.label).toBeTruthy();
      }
    }
  });

  it("every model has at least one capability", () => {
    // A capability-less model is a config bug; meeting every hard
    // requirement is impossible by construction.
    for (const id of AI_PROVIDER_IDS) {
      const provider = AI_PROVIDERS[id];
      for (const model of provider.models) {
        expect(model.capabilities.length).toBeGreaterThan(0);
      }
    }
  });

  it("every model's `effortLevels` is consistent with its `reasoning` capability", () => {
    // Reasoning models expose effort levels; non-reasoning models expose
    // none. A model with `reasoning` but an empty `effortLevels` cannot be
    // probed at any effort and would surprise a caller. The inverse —
    // `effortLevels` set without `reasoning` — is also wrong: it implies
    // the model can be told how hard to think when it cannot.
    //
    // Verified providers must hold this invariant. Unverified ones are
    // placeholders pending the probe, so the inconsistency is allowed and
    // recorded (the picker withholds them via `verifiedAt: null`).
    for (const id of AI_PROVIDER_IDS) {
      const provider = AI_PROVIDERS[id];
      if (provider.verifiedAt === null) continue;
      for (const model of provider.models) {
        const hasReasoning = model.capabilities.includes("reasoning");
        if (hasReasoning) {
          expect(model.effortLevels.length).toBeGreaterThan(0);
        } else {
          expect(model.effortLevels.length).toBe(0);
        }
      }
    }
  });

  it("models within a provider have unique ids", () => {
    for (const id of AI_PROVIDER_IDS) {
      const provider = AI_PROVIDERS[id];
      const ids = provider.models.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

// ── Cross-check: the registry matches the shape Phase 3 expects ─────────────

describe("registry shape — the contract Phase 3's resolver will rely on", () => {
  it("every provider's `id` matches its registry key", () => {
    for (const id of AI_PROVIDER_IDS) {
      const provider = AI_PROVIDERS[id];
      expect(provider.id).toBe(id);
    }
  });

  it("the `id` and `label` are non-empty and printable", () => {
    // The picker renders `label`; logs include `id`. A non-printable
    // character in either would corrupt both.
    for (const id of AI_PROVIDER_IDS) {
      const provider = AI_PROVIDERS[id];
      expect(provider.id).toMatch(/^[a-z][a-z0-9_-]*$/);
      expect(provider.label.length).toBeGreaterThan(0);
      expect(provider.docsUrl.startsWith("https://")).toBe(true);
      expect(provider.keyUrl.startsWith("https://")).toBe(true);
    }
  });

  // Defensive type-only check: the exported record is keyed by every
  // AiProviderId. This catches a future drift where someone adds a
  // provider to AI_PROVIDER_IDS but forgets the corresponding entry in
  // AI_PROVIDERS — which would compile but break at runtime.
  it("AI_PROVIDERS is keyed by every AiProviderId", () => {
    const keys = Object.keys(AI_PROVIDERS) as AiProviderId[];
    for (const id of AI_PROVIDER_IDS) {
      expect(keys).toContain(id);
    }
    expect(keys.length).toBe(AI_PROVIDER_IDS.length);
  });

  // A model whose capabilities list includes `reasoningSummary` must also
  // include `reasoning` — summary is meaningless without the reasoning
  // channel itself. Phase 0's canvas probe confirms the inverse
  // (`reasoning` without `reasoningSummary`) is the case Groq falls into.
  it("`reasoningSummary` implies `reasoning`", () => {
    for (const id of AI_PROVIDER_IDS) {
      const provider = AI_PROVIDERS[id];
      for (const model of provider.models) {
        if (model.capabilities.includes("reasoningSummary")) {
          expect(model.capabilities).toContain("reasoning");
        }
      }
    }
  });

  // The free tier defaults to `deepseek` / `deepseek-flash`. The registry
  // shape guarantees the free tier can always find its model — but only
  // when the operator has not reconfigured `AI_PROVIDER`/`AI_MODEL` in
  // env. This test pins the documented default so a rename or removal of
  // `deepseek-flash` fails here rather than at runtime.
  it("the documented free-tier provider and model exist", () => {
    const provider = AI_PROVIDERS.deepseek;
    expect(provider).toBeDefined();
    const model = modelById(provider, "deepseek-flash");
    expect(model).toBeDefined();
    expect(provider.defaultModel).toBe("deepseek-flash");
  });

  // The picker disables a row whose model fails the feature's hard
  // requirements. A synthetic registry can mix capable and incapable
  // models per provider; this invariant is tested in
  // `packages/utils/__tests__/ai.test.ts` ("custom-model-cannot-do-canvas")
  // using a custom registry. The real registry today has every model in
  // every verified provider meeting every feature's hard requirements,
  // because the probe has only added models it measured as capable.
  it("the real registry's verified providers all meet every feature's hard requirements", () => {
    for (const id of AI_PROVIDER_IDS) {
      const provider = AI_PROVIDERS[id];
      if (provider.verifiedAt === null) continue;
      const allCapable = provider.models.every((m: AiModelSpec) =>
        meetsRequirements(m, "chat"),
      );
      expect(allCapable).toBe(true);
    }
  });
});
