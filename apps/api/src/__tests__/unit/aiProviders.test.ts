/**
 * @module api/__tests__/unit/aiProviders
 * @description Resolver-side view of the registry plus the free-tier env
 * parser. The data lives in `@nimbus/types` and is pinned by
 * `aiRegistry.test.ts`; this suite covers the API-side wrapper, which is
 * where the operator's free-tier configuration lives.
 *
 * The branches worth pinning here are the ones a refactor is most likely
 * to silently break: an unknown `AI_PROVIDER` value (defaulting rather
 * than throwing) and the "operator key is empty string" parsing path.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  freeTier,
  getModel,
  getProvider,
  isEncryptionConfigured,
  modelMeetsRequirements,
} from "../../lib/ai/providers";

const ENV_KEYS = [
  "AI_API_KEY",
  "AI_PROVIDER",
  "AI_MODEL",
  "AI_CREDENTIAL_ENCRYPTION_KEY",
] as const;

let savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  savedEnv = {
    AI_API_KEY: process.env.AI_API_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
    AI_CREDENTIAL_ENCRYPTION_KEY: process.env.AI_CREDENTIAL_ENCRYPTION_KEY,
  };
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("freeTier — env parsing", () => {
  it("returns null when AI_API_KEY is unset", () => {
    delete process.env.AI_API_KEY;
    process.env.AI_PROVIDER = "deepseek";
    process.env.AI_MODEL = "deepseek-flash";
    expect(freeTier()).toBeNull();
  });

  it("returns null when AI_API_KEY is the empty string", () => {
    // An empty value is the documented "free tier disabled" signal. The
    // resolver turns this into `no-operator-key` rather than treating it
    // as a configured key that produces empty Authorization headers.
    process.env.AI_API_KEY = "";
    expect(freeTier()).toBeNull();
  });

  it("returns the documented defaults when configured minimally", () => {
    process.env.AI_API_KEY = "operator-key";
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    expect(freeTier()).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-flash",
    });
  });

  it("honours the operator's AI_PROVIDER / AI_MODEL overrides", () => {
    process.env.AI_API_KEY = "operator-key";
    process.env.AI_PROVIDER = "openai";
    process.env.AI_MODEL = "gpt-5-nano";
    expect(freeTier()).toEqual({
      providerId: "openai",
      modelId: "gpt-5-nano",
    });
  });

  it("falls back to the documented default when AI_PROVIDER is unknown", () => {
    // An unknown provider id is a misconfiguration rather than a normal
    // case; the resolver's failure mode later (when the provider id
    // cannot be resolved) is clearer than throwing here.
    process.env.AI_API_KEY = "operator-key";
    process.env.AI_PROVIDER = "not-a-provider";
    process.env.AI_MODEL = "deepseek-flash";
    expect(freeTier()).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-flash",
    });
  });

  it("falls back to deepseek-flash when AI_MODEL is empty", () => {
    process.env.AI_API_KEY = "operator-key";
    delete process.env.AI_PROVIDER;
    process.env.AI_MODEL = "";
    expect(freeTier()).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-flash",
    });
  });
});

describe("getProvider / getModel / modelMeetsRequirements — thin wrappers", () => {
  it("returns the registry entry for a known provider", () => {
    const provider = getProvider("deepseek");
    expect(provider?.baseUrl).toBe("https://api.deepseek.com");
  });

  it("returns undefined for a provider id that is not in the registry", () => {
    // The type system already prevents an unknown id at compile time; the
    // runtime guard exists because the persisted row might point at a
    // retired provider.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getProvider("retired" as any)).toBeUndefined();
  });

  it("returns the model spec for a known provider+model", () => {
    const provider = getProvider("deepseek");
    expect(getModel(provider!, "deepseek-flash")?.label).toBeTruthy();
  });

  it("returns undefined for an unknown model id on a known provider", () => {
    const provider = getProvider("deepseek");
    expect(getModel(provider!, "model-that-does-not-exist")).toBeUndefined();
  });

  it("delegates `modelMeetsRequirements` to the registry's `meetsRequirements`", () => {
    // The wrapper is a thin re-export; the predicate itself is pinned in
    // `aiRegistry.test.ts`. Here we just exercise the wrapper with a
    // known capable model and feature.
    const provider = getProvider("deepseek");
    const model = getModel(provider!, "deepseek-flash")!;
    expect(modelMeetsRequirements(model, "chat")).toBe(true);
  });
});

describe("isEncryptionConfigured — re-export", () => {
  it("returns true when AI_CREDENTIAL_ENCRYPTION_KEY is set", () => {
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY =
      "test-only-encryption-key-placeholder-not-a-real-credential";
    expect(isEncryptionConfigured()).toBe(true);
  });

  it("returns false when AI_CREDENTIAL_ENCRYPTION_KEY is unset", () => {
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    expect(isEncryptionConfigured()).toBe(false);
  });
});
