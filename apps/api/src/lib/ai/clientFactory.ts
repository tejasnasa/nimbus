/**
 * @module api/lib/ai/clientFactory
 * @description The single module in the app that constructs SDK clients.
 *
 * `groqClient.ts` and `openaiClient.ts` are module-level `new OpenAI(...)`
 * singletons built at import time, and the SDK throws when the key is
 * absent — so the env vars they read had to be required. This factory is
 * the seam that removes that requirement: callers pass a key in, the client
 * is constructed lazily, and a process without any keys can still boot.
 *
 * The factory also owns:
 *   - a small bounded cache so per-message key churn does not pay a
 *     `new OpenAI(...)` per call, while a removed credential stops being
 *     usable within ten minutes;
 *   - `reasoningKwargs`, which is the one piece of per-provider request
 *     shaping the call sites cannot decide on their own — Groq rejects
 *     `reasoning.summary` outright, so the kwargs must omit it where the
 *     model lacks the capability;
 *   - the error classifier that turns SDK errors into the user-visible
 *     reasons (`invalid-key`, `provider-error`). The reasons are what the
 *     chat handler emits on `ai:refused`; the SDK's raw text never reaches
 *     the user because it can echo parameters (including the key) in some
 *     error formats.
 *
 * @important Clients are constructed with `apiKey` and `baseURL` explicitly
 *            set, NEVER inherited from `OPENAI_BASE_URL`. Inheritance is a
 *            hazard in production (a stray env var silently redirects every
 *            call) but a useful hook for stubbing in tests — if E2E ever
 *            needs to intercept model calls, that is the lever.
 */
import OpenAI from "openai";
import {
  type AiEffort,
  type AiModelSpec,
  type AiProviderSpec,
} from "@nimbus/types";

/** The handle the resolver hands to the call sites. */
export type AiClientHandle = {
  /** The provider that constructed this client. Drives log lines. */
  readonly providerId: string;
  /** The model the handle serves. Call sites pass it to `responses.create`. */
  readonly modelId: string;
  /** Whether the key was the user's (BYOK) or the operator's (free tier). */
  readonly source: "byok" | "free";
  /**
   * Whether `reasoning: { effort }` may be sent at all. False when the model
   * lacks the `reasoning` capability; the call sites skip `reasoningKwargs`
   * in that case rather than sending an extra the model 400s on.
   */
  readonly supportsReasoning: boolean;
  /**
   * The constructed SDK client. `baseURL` is already applied, so call sites
   * do not set it again.
   */
  readonly client: OpenAI;
};

/** Source argument to {@link createAiClient}. */
export type AiClientSource = "byok" | "free";

/** Options for {@link createAiClient}. */
export type CreateAiClientOptions = {
  /** The registry entry whose base URL the client uses. */
  readonly provider: AiProviderSpec;
  /**
   * The API key the client is constructed with. Never logged, never
   * returned on the handle, never included in the cache key (use
   * `keyFingerprint` for that).
   */
  readonly apiKey: string;
  /**
   * The model the handle serves. Must be in `provider.models`.
   */
  readonly model: AiModelSpec;
  /** Provenance label for logs and `AiStatusDTO.substituted`. */
  readonly source: AiClientSource;
};

/**
 * Cache key for constructed clients. The fingerprint is a non-reversible
 * ledger identity (`sha256(apiKey).slice(0,16)`), so the cache holds the
 * least amount of identifying material it can while still letting two
 * credentials for the same provider stay distinct.
 */
type CacheKey = `${string}|${string}|${string}`;

const CACHE_MAX_ENTRIES = 50;
/** Ten minutes — long enough to amortise per-message construction, short
 *  enough that a removed credential stops being usable promptly. */
const CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = {
  readonly handle: AiClientHandle;
  readonly expiresAt: number;
};

/** Bounded LRU-ish cache. Keyed by `${providerId}|${keyFingerprint}|${modelId}`. */
const cache = new Map<CacheKey, CacheEntry>();

/**
 * Returns a cached handle when present and unexpired, otherwise constructs
 * one and stores it. The cache evicts the oldest entry on overflow — a
 * process-local Map preserves insertion order, so the first key in is the
 * one removed.
 */
export function createAiClient(options: CreateAiClientOptions): AiClientHandle {
  const keyFingerprint = fingerprintForLogging(options.apiKey);
  const cacheKey: CacheKey = `${options.provider.id}|${keyFingerprint}|${options.model.id}`;

  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    // LRU touch: delete + reinsert to move the entry to the back.
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached.handle;
  }

  const handle = buildHandle(options);
  cache.set(cacheKey, { handle, expiresAt: now + CACHE_TTL_MS });
  evictIfOverCap();
  return handle;
}

/**
 * Builds the handle. Extracted from {@link createAiClient} so the test suite
 * can assert on a fresh client without first populating the cache.
 *
 * @param options - See {@link CreateAiClientOptions}.
 * @returns The constructed handle.
 */
function buildHandle(options: CreateAiClientOptions): AiClientHandle {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.provider.baseUrl,
  });

  return {
    providerId: options.provider.id,
    modelId: options.model.id,
    source: options.source,
    supportsReasoning: options.model.capabilities.includes("reasoning"),
    client,
  };
}

/**
 * Drops the entry whose `expiresAt` is oldest when the cache overflows.
 * O(n) but n is small (max 50) and the operation is rare, so an explicit
 * LRU is not worth its weight.
 */
function evictIfOverCap(): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  let oldestKey: CacheKey | null = null;
  let oldestExpiry = Number.POSITIVE_INFINITY;
  for (const [key, entry] of cache) {
    if (entry.expiresAt < oldestExpiry) {
      oldestExpiry = entry.expiresAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) cache.delete(oldestKey);
}

/**
 * Computes a non-reversible fingerprint of an API key for the cache key.
 *
 * The fingerprint is the same primitive `credentialCrypto.fingerprintSecret`
 * exposes (sha256 truncated to 16 hex chars), but re-derived locally so this
 * module does not have to take a dependency on the encryption module for a
 * non-crypto operation.
 */
function fingerprintForLogging(apiKey: string): string {
  // Dynamic import of node:crypto to keep the module surface area small —
  // the SDK is the dominant cost.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(apiKey, "utf8").digest("hex").slice(0, 16);
}

/**
 * Resets the cache. Test-only escape hatch — production code has no reason
 * to clear it, and removing this would force every test to construct clients
 * fresh and lose the assertion that the cache actually returns the same
 * instance.
 */
export function __resetClientCacheForTests(): void {
  cache.clear();
}

/**
 * Per-request `reasoning` kwargs for a model that supports reasoning.
 *
 * Two fields are sent — `effort` and `summary` — but Groq's gpt-oss models
 * accept `effort` and reject `summary` outright with
 * `400 Field 'reasoning.summary' is not supported`. So this returns:
 *   - `{}` when the model has no `reasoning` capability at all;
 *   - `{ reasoning: { effort } }` when the model has `reasoning` but not
 *     `reasoningSummary` (Groq's case);
 *   - `{ reasoning: { effort, summary: "detailed" } }` when the model has
 *     both capabilities (DeepSeek and OpenAI gpt-5-nano, per the Phase 0
 *     probe).
 *
 * @param handle - The client handle whose model the kwargs target.
 * @param effort - The effort level the model should think at. DeepSeek does
 *                 not accept `minimal`, so callers needing the cheapest call
 *                 must use `low`.
 * @returns A `Record<string, unknown>` safe to spread into a `responses.create`
 *          call. Empty when reasoning is unsupported.
 */
export function reasoningKwargs(
  handle: AiClientHandle,
  effort: AiEffort,
): Record<string, unknown> {
  if (!handle.supportsReasoning) return {};

  const reasoning: Record<string, unknown> = { effort };

  // The handle carries `supportsReasoning`, not the finer-grained
  // `reasoningSummary` capability. Look the model up by id: the registry is
  // a thin re-export, and the model spec is the authoritative source.
  const modelSpec = lookupModelSpec(handle.providerId, handle.modelId);
  if (modelSpec?.capabilities.includes("reasoningSummary")) {
    reasoning.summary = "detailed";
  }

  return { reasoning };
}

/**
 * Looks up the model spec from the registry by provider+model id.
 *
 * Imported lazily here (rather than at the top of the module) so this file
 * stays decoupled from the concrete registry object — the resolver hands us
 * a `providerId`, and we re-derive the spec from the typed registry.
 */
function lookupModelSpec(
  providerId: string,
  modelId: string,
): AiModelSpec | undefined {
  // Imported inside the function so a future "swap the registry source"
  // change has one place to touch. The cost is one import per reasoning
  // call, which is small relative to a model call.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AI_PROVIDERS, modelById } =
    require("@nimbus/types") as typeof import("@nimbus/types");
  const provider = AI_PROVIDERS[providerId as keyof typeof AI_PROVIDERS];
  if (!provider) return undefined;
  return modelById(provider, modelId);
}

/**
 * The user-visible failure reasons the resolver / call sites can produce.
 *
 * `invalid-key` and `provider-error` are produced *here*, at call time —
 * the resolver does no network call and cannot know which one applies. The
 * reasons are curated, generic, and never carry the provider's raw error
 * text, because that text can echo parameters (including the key) in some
 * SDK error formats.
 */
export type ClientCallError =
  | { kind: "invalid-key"; message: string }
  | { kind: "provider-error"; message: string };

/**
 * Classifies an SDK error into a curated user-visible reason.
 *
 * Mapping:
 *   - `AuthenticationError` (401) → `invalid-key`
 *   - `PermissionDeniedError` (403) → `invalid-key` (treated identically;
 *     a key without the required scope is still the user's problem, and a
 *     raw 403 message would echo the model id)
 *   - everything else → `provider-error`
 *
 * The thrown error's `status` field is the source of truth — the SDK's
 * per-error classes are also exported but reading the status keeps the
 * classifier from depending on a particular SDK error taxonomy.
 *
 * @param err - The thrown value. Anything that isn't an `Error` with a
 *              `status` is treated as `provider-error`.
 * @returns The curated reason. The `message` is generic — never the
 *          provider's raw text, never the key.
 */
export function classifyClientError(err: unknown): ClientCallError {
  const status = errorStatus(err);
  if (status === 401 || status === 403) {
    return {
      kind: "invalid-key",
      message:
        "The provider rejected the credential. Update it in AI settings.",
    };
  }
  return {
    kind: "provider-error",
    message:
      "The AI provider could not complete the request. Please try again.",
  };
}

/**
 * Extracts an HTTP status from an unknown thrown value.
 *
 * The OpenAI SDK attaches `status` to its error instances; we tolerate
 * non-Error throws (the chat pipeline catches strings), and we tolerate
 * any extra fields. A missing `status` is treated as `undefined`.
 */
function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") return status;
  return undefined;
}
