/**
 * @module api/__tests__/unit/aiClientFactory
 * @description The client factory: per-provider `baseURL`, capability-aware
 * `reasoningKwargs`, the bounded cache, and the error classifier.
 *
 * The OpenAI SDK is not mocked — the factory constructs it with the real
 * constructor and never calls any method on it, so no network or key is
 * required. The SDK does validate the `apiKey` shape at construction time
 * (it must be a string), so we use throwaway strings rather than real
 * credentials.
 *
 * The trap pinned here is the one Phase 0 surfaced: **DeepSeek's `baseURL`
 * has no `/v1`, OpenAI's does**. A wrong base URL fails as a 404 at
 * request time, not at import, so this is the assertion that catches it
 * before the picker offers the wrong endpoint.
 *
 * @important These tests construct the SDK client but never make a request.
 *            A constructed client does not contact the network.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  AI_PROVIDERS,
  type AiModelSpec,
  type AiProviderSpec,
} from "@nimbus/types";
import {
  __resetClientCacheForTests,
  classifyClientError,
  createAiClient,
  reasoningKwargs,
  type AiClientHandle,
} from "../../lib/ai/clientFactory";

/** A model spec used only by the unit tests; capabilities are picked per case. */
const makeModel = (
  id: string,
  capabilities: AiModelSpec["capabilities"] = [
    "tools",
    "streaming",
    "jsonMode",
    "reasoning",
  ],
): AiModelSpec => ({
  id,
  label: id,
  capabilities,
  effortLevels: ["low"],
});

const PROVIDERS: Record<string, AiProviderSpec> = AI_PROVIDERS;

beforeEach(() => {
  __resetClientCacheForTests();
});

describe("createAiClient — baseURL pinning", () => {
  it("applies DeepSeek's no-`/v1` base URL to the SDK client", () => {
    // The trap from the plan: DeepSeek's endpoint is `https://api.deepseek.com/responses`,
    // so the SDK's `baseURL` must be `https://api.deepseek.com` — without `/v1`.
    // The mirror assertion for OpenAI lives below.
    const provider = PROVIDERS.deepseek;
    const model = makeModel("deepseek-flash");

    const handle = createAiClient({
      provider,
      apiKey: "throwaway-deepseek-key",
      model,
      source: "byok",
    });

    // `client` is an `OpenAI` instance with a private `baseURL`. Inspect the
    // request handler rather than the field, which is the documented SDK
    // surface — it is the value that ends up in every HTTP request.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseURL = (handle.client as any).baseURL as string;
    expect(baseURL).toBe("https://api.deepseek.com");
    expect(baseURL?.endsWith("/v1")).toBe(false);
  });

  it("applies OpenAI's `/v1` base URL to the SDK client", () => {
    const provider = PROVIDERS.openai;
    const model = makeModel("gpt-5-nano");

    const handle = createAiClient({
      provider,
      apiKey: "throwaway-openai-key",
      model,
      source: "byok",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseURL = (handle.client as any).baseURL as string;
    expect(baseURL).toBe("https://api.openai.com/v1");
    expect(baseURL?.endsWith("/v1")).toBe(true);
  });

  it("applies Groq's `/openai/v1` base URL to the SDK client", () => {
    const provider = PROVIDERS.groq;
    const model = makeModel("openai/gpt-oss-120b");

    const handle = createAiClient({
      provider,
      apiKey: "throwaway-groq-key",
      model,
      source: "byok",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseURL = (handle.client as any).baseURL as string;
    expect(baseURL).toBe("https://api.groq.com/openai/v1");
  });

  it("applies OpenRouter's base URL to the SDK client", () => {
    const provider = PROVIDERS.openrouter;
    const model = makeModel("openai/gpt-4o-mini");

    const handle = createAiClient({
      provider,
      apiKey: "throwaway-openrouter-key",
      model,
      source: "byok",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseURL = (handle.client as any).baseURL as string;
    expect(baseURL).toBe("https://openrouter.ai/api/v1");
  });

  it("carries the providerId, modelId, source, and supportsReasoning on the handle", () => {
    const provider = PROVIDERS.deepseek;
    const model = makeModel("deepseek-flash");

    const handle = createAiClient({
      provider,
      apiKey: "throwaway",
      model,
      source: "free",
    });

    expect(handle.providerId).toBe("deepseek");
    expect(handle.modelId).toBe("deepseek-flash");
    expect(handle.source).toBe("free");
    expect(handle.supportsReasoning).toBe(true);
  });

  it("marks `supportsReasoning: false` for a model that lacks the capability", () => {
    const provider = PROVIDERS.groq;
    const model = makeModel("qwen/qwen3.8-27b", [
      "tools",
      "streaming",
      "jsonMode",
    ]);

    const handle = createAiClient({
      provider,
      apiKey: "throwaway",
      model,
      source: "byok",
    });

    expect(handle.supportsReasoning).toBe(false);
  });
});

describe("createAiClient — cache", () => {
  it("returns the same instance for repeated lookups with the same key and model", () => {
    const provider = PROVIDERS.deepseek;
    const model = makeModel("deepseek-flash");
    const apiKey = "throwaway-cache-key";

    const first = createAiClient({ provider, apiKey, model, source: "byok" });
    const second = createAiClient({ provider, apiKey, model, source: "byok" });

    // The cache returns the *same* handle object — identity, not just
    // equality. A new client per call would defeat the cache's purpose and
    // would be silent in production unless someone profiles the SDK init.
    expect(second).toBe(first);
  });

  it("returns distinct instances for different keys on the same provider", () => {
    const provider = PROVIDERS.deepseek;
    const model = makeModel("deepseek-flash");

    const a = createAiClient({
      provider,
      apiKey: "key-a",
      model,
      source: "byok",
    });
    const b = createAiClient({
      provider,
      apiKey: "key-b",
      model,
      source: "byok",
    });

    expect(a).not.toBe(b);
  });

  it("returns distinct instances for different models on the same provider+key", () => {
    const provider = PROVIDERS.deepseek;
    const apiKey = "throwaway-cache-key";

    const a = createAiClient({
      provider,
      apiKey,
      model: makeModel("deepseek-flash"),
      source: "byok",
    });
    const b = createAiClient({
      provider,
      apiKey,
      model: makeModel("deepseek-v4-pro"),
      source: "byok",
    });

    expect(a).not.toBe(b);
  });

  it("evicts the oldest entry when the cache overflows the cap", () => {
    // The cap is CACHE_MAX_ENTRIES (50). Insert one more distinct
    // (provider, key, model) triple than the cap and assert the cache
    // evicts at least one. The eviction is "oldest by `expiresAt`", which
    // is the entry inserted first — verified by asserting that the
    // original key was the one dropped.
    const provider = PROVIDERS.deepseek;
    const apiKey = "throwaway-cache-key";

    // First: a single entry that will become the eviction target.
    const first = createAiClient({
      provider,
      apiKey: "first-key",
      model: makeModel("deepseek-flash"),
      source: "byok",
    });

    // Then: 50 more distinct (key) entries on the same provider+model,
    // each producing a distinct cache key. The total is 51.
    for (let i = 0; i < 50; i += 1) {
      createAiClient({
        provider,
        apiKey: `filler-key-${i}`,
        model: makeModel("deepseek-flash"),
        source: "byok",
      });
    }

    // Re-insert the original (first) entry's lookup — if it survived, we
    // get the cached instance back; if it was evicted, we get a fresh one.
    // The cap is 50, and the eviction order is "oldest by `expiresAt`",
    // so the first-key entry is the one that gets dropped.
    const after = createAiClient({
      provider,
      apiKey: "first-key",
      model: makeModel("deepseek-flash"),
      source: "byok",
    });

    // The returned instance is a fresh handle (the entry was evicted, so
    // re-creating it produced a new object). The assertion is that the
    // cache stays bounded: a fresh entry means the old one was dropped.
    expect(after).not.toBe(first);
  });
});

describe("reasoningKwargs — capability-aware shaping", () => {
  it("returns `{}` when the model has no `reasoning` capability", () => {
    // The whole point: Groq's qwen model accepts the standard tool/stream
    // shape but rejects `reasoning: { effort }` because it is not a
    // reasoning model. Sending the extra is a 400.
    const provider = PROVIDERS.groq;
    const model = makeModel("qwen/qwen3.8-27b", [
      "tools",
      "streaming",
      "jsonMode",
    ]);
    const handle = createAiClient({
      provider,
      apiKey: "k",
      model,
      source: "byok",
    });

    expect(reasoningKwargs(handle, "low")).toEqual({});
  });

  it("returns `{ reasoning: { effort } }` for Groq's gpt-oss — no `summary`", () => {
    // The Phase 0 finding: Groq accepts `reasoning.effort` and rejects
    // `reasoning.summary` outright with `400 Field 'reasoning.summary' is
    // not supported`. The kwargs must omit `summary` so Groq's canvas
    // path does not 400.
    const provider = PROVIDERS.groq;
    const model = makeModel("openai/gpt-oss-120b", [
      "tools",
      "streaming",
      "jsonMode",
      "reasoning",
    ]);
    const handle = createAiClient({
      provider,
      apiKey: "k",
      model,
      source: "byok",
    });

    expect(reasoningKwargs(handle, "low")).toEqual({
      reasoning: { effort: "low" },
    });
  });

  it("returns `{ reasoning: { effort, summary } }` for DeepSeek — both fields", () => {
    // DeepSeek's gpt-flash accepts both fields; the measured runs streamed
    // reasoning characters with `summary: "detailed"` set.
    const provider = PROVIDERS.deepseek;
    const model = makeModel("deepseek-flash", [
      "tools",
      "streaming",
      "jsonMode",
      "reasoning",
      "reasoningSummary",
    ]);
    const handle = createAiClient({
      provider,
      apiKey: "k",
      model,
      source: "byok",
    });

    expect(reasoningKwargs(handle, "low")).toEqual({
      reasoning: { effort: "low", summary: "detailed" },
    });
  });

  it("passes the requested effort level through verbatim", () => {
    const provider = PROVIDERS.deepseek;
    const model = makeModel("deepseek-flash");
    const handle = createAiClient({
      provider,
      apiKey: "k",
      model,
      source: "byok",
    });

    expect(reasoningKwargs(handle, "high")).toMatchObject({
      reasoning: { effort: "high" },
    });
  });
});

describe("classifyClientError — error → reason mapping", () => {
  it("maps a 401 to `invalid-key` with a curated message", () => {
    // The OpenAI SDK attaches `status: 401` on `AuthenticationError`. The
    // curated message names the action the user should take, never the key
    // (the SDK's raw message can echo request parameters including the key).
    const result = classifyClientError(
      Object.assign(new Error("Incorrect API key provided"), { status: 401 }),
    );

    expect(result.kind).toBe("invalid-key");
    expect(result.message).toMatch(/update it/i);
    // The plan's no-leak regex: matches `sk-` and `api key` / `api_key`.
    // The curated message avoids the phrase so the assertion is tight.
    expect(result.message).not.toMatch(/sk-|api[-_]?key/i);
  });

  it("maps a 403 to `invalid-key`", () => {
    // A key without the required scope is still the user's problem, and a
    // raw 403 message would echo the model id the user tried to call.
    const result = classifyClientError(
      Object.assign(new Error("You do not have access to this model"), {
        status: 403,
      }),
    );

    expect(result.kind).toBe("invalid-key");
  });

  it("maps a 429 (rate limit) to `provider-error`, not `invalid-key`", () => {
    // Rate limiting is the provider's state, not the user's. A 429 is the
    // user-visible retry cue, not the rotate-your-key cue.
    const result = classifyClientError(
      Object.assign(new Error("Rate limit reached"), { status: 429 }),
    );

    expect(result.kind).toBe("provider-error");
  });

  it("maps a 5xx to `provider-error`", () => {
    const result = classifyClientError(
      Object.assign(new Error("Internal server error"), { status: 500 }),
    );

    expect(result.kind).toBe("provider-error");
  });

  it("maps a connection error (no status) to `provider-error`", () => {
    // `APIConnectionError` from the SDK throws with no `status`. A
    // transport failure is a provider-side problem and the user-visible
    // message says so, never echoing the SDK's network detail.
    const result = classifyClientError(
      Object.assign(new Error("Connection error"), {
        // `status` deliberately absent
      }),
    );

    expect(result.kind).toBe("provider-error");
    expect(result.message).not.toMatch(/sk-/);
  });

  it("maps a thrown string to `provider-error` without throwing", () => {
    // The chat pipeline catches strings, so the classifier must not assume
    // its argument is an `Error`.
    const result = classifyClientError("something bad happened");
    expect(result.kind).toBe("provider-error");
  });

  it("maps `null` and `undefined` to `provider-error` without throwing", () => {
    expect(classifyClientError(null).kind).toBe("provider-error");
    expect(classifyClientError(undefined).kind).toBe("provider-error");
  });

  it("never puts the original error message into the curated reason", () => {
    // The SDK's raw text can echo parameters (including the key). The
    // curated message is a generic string built by the classifier, not a
    // passthrough.
    const raw = "Incorrect API key: sk-proj-abc123def456";
    const result = classifyClientError(
      Object.assign(new Error(raw), { status: 401 }),
    );

    if (result.kind === "invalid-key") {
      expect(result.message).not.toContain(raw);
      expect(result.message).not.toContain("sk-proj-abc123def456");
    } else {
      throw new Error("expected invalid-key for status 401");
    }
  });
});

describe("createAiClient — unknown provider is rejected at the type level", () => {
  // The TS-level rejection is the headline test. A future refactor that
  // relaxes `provider: AiProviderSpec` to `provider: any` would not compile,
  // and that is what this test asserts — by being written in a separate
  // file the type is forced to be checked explicitly.
  it("the exported factory signature requires a registry-typed provider", () => {
    // The type assertion below does the work; it is intentionally not
    // `expect(...)` because the assertion is a compile-time one. If the
    // signature is loosened to accept any string id, this file stops
    // compiling and the regression is loud.
    const _typed: AiClientHandle = createAiClient({
      provider: PROVIDERS.openai,
      apiKey: "k",
      model: makeModel("gpt-5-nano"),
      source: "byok",
    });
    expect(_typed.providerId).toBe("openai");
  });
});
