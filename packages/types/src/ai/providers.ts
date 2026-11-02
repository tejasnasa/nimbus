/**
 * @module types/ai/providers
 * @description The provider registry: which OpenAI-compatible endpoints Nimbus
 * can talk to, and what each of their models can do.
 *
 * @important This module must import **nothing** — no settings, no app code, no
 *            other package. The Phase 0 probe imports it to learn the base URL
 *            the application will actually use, and if it could not, the probe
 *            would have to duplicate those URLs, which would defeat the point of
 *            verifying them. It is also loaded by the web client's model picker,
 *            so it ships in the browser bundle and must stay dependency-free.
 *
 * @important `baseUrl` is per-provider and is **not** uniform. DeepSeek's is
 *            `https://api.deepseek.com` — with no `/v1`, unlike OpenAI's — and
 *            the SDK appends `/responses` to whatever is given. A wrong value
 *            here fails as a 404 at request time, not at import, which is why
 *            `verifiedAt` is stamped by measurement rather than assumed.
 */

/** The three AI call sites, which have different capability requirements. */
export type AiFeature = "chat" | "markdown" | "canvas";

/** What a model can do. Drives the picker's hard filter. */
export type AiCapability =
  | "tools"
  | "streaming"
  | "jsonMode"
  | "reasoning"
  /**
   * Accepts `reasoning.summary`. A capability of its own, measured separately
   * from `reasoning`: Groq's gpt-oss models accept `reasoning.effort` and reject
   * `reasoning.summary` outright with
   * `400 Field 'reasoning.summary' is not supported` — and `canvasGeneration.ts`
   * sends both fields, so a provider lacking this capability needs the summary
   * omitted rather than the request failing.
   */
  | "reasoningSummary"
  /** Accepts image input (`input_image`). Shown as a chip; not a hard requirement. */
  | "vision";

/** Where a selectable model came from. See `AiFeaturePreference.modelSource`. */
export const AI_MODEL_SOURCES = ["registry", "catalog", "custom"] as const;

/**
 * - `registry`: the curated {@link AiModelSpec} list in this module.
 * - `catalog`: OpenRouter's live model catalogue.
 * - `custom`: an id the user typed, whose capabilities were measured by a probe.
 */
export type AiModelSource = (typeof AI_MODEL_SOURCES)[number];

/**
 * List prices in USD, from the provider's own pricing page. Every price is
 * optional: a missing one means "not confirmed", and cost estimation returns
 * `null` rather than guessing.
 */
export type AiModelPricing = {
  /** USD per million input tokens. */
  inputPerMTok?: number;
  /** USD per million output tokens. */
  outputPerMTok?: number;
  /** USD per minute of audio (transcription). */
  perAudioMinute?: number;
  /** USD per million characters (speech synthesis). */
  perMChars?: number;
  /** ISO date the price was read from the provider's page. */
  checkedAt: string;
};

/** A reasoning effort level. Providers differ; DeepSeek accepts low|high|max. */
export type AiEffort = "minimal" | "low" | "high" | "max";

/** One selectable model. */
export type AiModelSpec = {
  /** The wire id, exactly as the provider spells it. */
  id: string;
  /** Human label for the picker. */
  label: string;
  capabilities: readonly AiCapability[];
  /** Effort levels this model accepts, from the provider's own model listing. */
  effortLevels: readonly AiEffort[];
  /** List prices, when confirmed from the provider's pricing page. */
  pricing?: AiModelPricing;
};

/** One OpenAI-compatible provider. */
export type AiProviderSpec = {
  id: AiProviderId;
  label: string;
  /** Base URL the SDK appends `/responses` to. See the module header. */
  baseUrl: string;
  docsUrl: string;
  keyUrl: string;
  /** The model used when the user or the free tier does not name one. */
  defaultModel: string;
  /**
   * Whether `reasoning: { effort }` may be sent at all.
   * False for a provider whose models are not reasoning models: the parameter is
   * a Responses-API extra that such a model can reject with a 400, and a 400 on
   * a generation path surfaces as a failed answer rather than a config error.
   */
  supportsReasoning: boolean;
  models: readonly AiModelSpec[];
  /**
   * ISO date the probe last confirmed this provider's shape and capabilities, or
   * null when unverified. The picker treats null as "not offered yet" so an
   * unmeasured provider can never be selected and then fail at request time.
   */
  verifiedAt: string | null;
};

export const AI_PROVIDER_IDS = [
  "openai",
  "groq",
  "deepseek",
  "openrouter",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_PROVIDERS: Record<AiProviderId, AiProviderSpec> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    docsUrl: "https://platform.openai.com/docs/api-reference/responses",
    keyUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-5-nano",
    supportsReasoning: true,
    // Capabilities are listed from the provider's published model docs and are
    // confirmed by the probe; a model is only offered once its provider's
    // `verifiedAt` is stamped.
    models: [
      {
        id: "gpt-5-nano",
        label: "GPT-5 Nano",
        capabilities: ["tools", "streaming", "jsonMode", "reasoning", "reasoningSummary", "vision"],
        effortLevels: ["minimal", "low", "high"],
        pricing: { inputPerMTok: 0.05, outputPerMTok: 0.4, checkedAt: "2026-11-02" },
      },
      {
        id: "gpt-6-luna",
        label: "GPT-6 Luna",
        // Measured with a live key on 2026-11-03.
        capabilities: ["tools", "streaming", "jsonMode", "reasoning", "reasoningSummary", "vision"],
        effortLevels: ["low", "high"],
        pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5, checkedAt: "2026-11-03" },
      },
      {
        id: "gpt-5-mini",
        label: "GPT-5 Mini",
        capabilities: ["tools", "streaming", "jsonMode", "reasoning", "reasoningSummary", "vision"],
        effortLevels: ["minimal", "low", "high"],
        pricing: { inputPerMTok: 0.25, outputPerMTok: 2, checkedAt: "2026-11-02" },
      },
      {
        id: "gpt-5",
        label: "GPT-5",
        capabilities: ["tools", "streaming", "jsonMode", "reasoning", "reasoningSummary", "vision"],
        effortLevels: ["minimal", "low", "high"],
        pricing: { inputPerMTok: 1.25, outputPerMTok: 10, checkedAt: "2026-11-02" },
      },
      {
        id: "gpt-4.1-mini",
        label: "GPT-4.1 Mini",
        capabilities: ["tools", "streaming", "jsonMode", "vision"],
        effortLevels: [],
        pricing: { inputPerMTok: 0.4, outputPerMTok: 1.6, checkedAt: "2026-11-02" },
      },
    ],
    verifiedAt: "2026-09-27",
  },

  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    docsUrl: "https://console.groq.com/docs/api-reference",
    keyUrl: "https://console.groq.com/keys",
    defaultModel: "openai/gpt-oss-120b",
    // Measured true: gpt-oss accepts `reasoning: { effort }`. Its Llama models
    // do not — sending the parameter to them is a Responses-API extra they
    // reject — which is why this is per-provider and stated per model below.
    supportsReasoning: true,
    models: [
      {
        id: "openai/gpt-oss-120b",
        label: "GPT-OSS 120B",
        capabilities: ["tools", "streaming", "jsonMode", "reasoning"],
        effortLevels: ["low", "high"],
        pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6, checkedAt: "2026-11-02" },
      },
      {
        id: "openai/gpt-oss-20b",
        label: "GPT-OSS 20B",
        capabilities: ["tools", "streaming", "jsonMode", "reasoning"],
        effortLevels: ["low", "high"],
        pricing: { inputPerMTok: 0.075, outputPerMTok: 0.3, checkedAt: "2026-11-02" },
      },
      {
        id: "qwen/qwen3.8-27b",
        label: "Qwen 3.8 27B",
        capabilities: ["tools", "streaming", "jsonMode"],
        effortLevels: [],
        pricing: { inputPerMTok: 0.8, outputPerMTok: 4, checkedAt: "2026-11-02" },
      },
      {
        // Production model; Groq lists its price as "contact sales", so none is recorded.
        id: "llama-3.3-70b-versatile",
        label: "Llama 3.3 70B",
        capabilities: ["tools", "streaming", "jsonMode"],
        effortLevels: [],
      },
      {
        // Production model; Groq lists its price as "contact sales", so none is recorded.
        id: "llama-3.1-8b-instant",
        label: "Llama 3.1 8B Instant",
        capabilities: ["tools", "streaming", "jsonMode"],
        effortLevels: [],
      },
    ],
    verifiedAt: "2026-09-27",
  },

  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    // No `/v1`. See the module header.
    baseUrl: "https://api.deepseek.com",
    docsUrl: "https://api-docs.deepseek.com/",
    keyUrl: "https://platform.deepseek.com/api_keys",
    defaultModel: "deepseek-flash",
    supportsReasoning: true,
    models: [
      {
        id: "deepseek-flash",
        label: "DeepSeek V4.1 Flash",
        // `reasoningSummary` measured accepted — the measured runs streamed
        // 1.5k–17k reasoning characters with `summary: "detailed"` set. `vision`
        // measured accepted with a live key on 2026-11-03.
        capabilities: ["tools", "streaming", "jsonMode", "reasoning", "reasoningSummary", "vision"],
        // From the provider's model listing. Note `minimal` is absent: the
        // cheapest effort DeepSeek accepts is `low`.
        effortLevels: ["low", "high", "max"],
        // Peak-hour rate. DeepSeek halves it off-peak, so an estimate built from
        // this is an upper bound.
        pricing: { inputPerMTok: 0.3, outputPerMTok: 1.2, checkedAt: "2026-11-02" },
      },
      {
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        capabilities: ["tools", "streaming", "jsonMode", "reasoning", "reasoningSummary"],
        effortLevels: ["low", "high", "max"],
        // Peak-hour rate; see above.
        pricing: { inputPerMTok: 1.32, outputPerMTok: 3.96, checkedAt: "2026-11-02" },
      },
    ],
    verifiedAt: "2026-09-27",
  },

  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    docsUrl: "https://openrouter.ai/docs/api_reference/responses/overview",
    keyUrl: "https://openrouter.ai/keys",
    defaultModel: "openai/gpt-4o-mini",
    supportsReasoning: true,
    models: [
      {
        id: "openai/gpt-4o-mini",
        label: "GPT-4o mini",
        capabilities: ["tools", "streaming", "jsonMode", "vision"],
        effortLevels: [],
        pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6, checkedAt: "2026-11-02" },
      },
      {
        id: "openai/gpt-5-mini",
        label: "GPT-5 Mini",
        capabilities: ["tools", "streaming", "jsonMode", "reasoning", "vision"],
        effortLevels: ["low", "high"],
        pricing: { inputPerMTok: 0.25, outputPerMTok: 2, checkedAt: "2026-11-02" },
      },
      {
        id: "deepseek/deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        capabilities: ["tools", "streaming", "jsonMode", "reasoning"],
        effortLevels: ["low", "high"],
        pricing: { inputPerMTok: 0.091, outputPerMTok: 0.182, checkedAt: "2026-11-02" },
      },
    ],
    // Key probe and capability probe passed against the Responses API with a
    // live key, measured on a free catalogue model.
    verifiedAt: "2026-11-03",
  },
};

/** Hard requirements — a model missing any of these is not offered for the feature. */
export const AI_FEATURE_REQUIREMENTS: Record<AiFeature, readonly AiCapability[]> = {
  // `create_document` is delivered as a tool call, so a model without tools
  // cannot produce a document at all.
  chat: ["tools"],
  markdown: ["streaming"],
  // The tolerant-JSON pipeline needs both: streaming for the live overlay and
  // structured output for anything to parse.
  canvas: ["streaming", "jsonMode"],
};

/**
 * Soft requirements — the model is still offered, with a warning.
 *
 * `reasoning` is deliberately soft for canvas. Reasoning feeds only the
 * generation-log panel and one last-resort JSON salvage path; the primary parse
 * needs jsonMode alone. Requiring it would exclude most of the catalogue to
 * protect a fallback.
 */
export const AI_FEATURE_RECOMMENDED: Record<AiFeature, readonly AiCapability[]> = {
  chat: [],
  markdown: ["reasoning"],
  canvas: ["reasoning"],
};

/** The provider's model spec, or undefined when the id is not in the registry. */
export function modelById(
  provider: AiProviderSpec,
  modelId: string,
): AiModelSpec | undefined {
  return provider.models.find((m) => m.id === modelId);
}

/** Whether a model satisfies every hard requirement for a feature. */
export function meetsRequirements(
  model: AiModelSpec,
  feature: AiFeature,
): boolean {
  return AI_FEATURE_REQUIREMENTS[feature].every((c) =>
    model.capabilities.includes(c),
  );
}

/** The models of a provider that may be offered for a feature, in registry order. */
export function modelsFor(
  provider: AiProviderSpec,
  feature: AiFeature,
): readonly AiModelSpec[] {
  return provider.models.filter((m) => meetsRequirements(m, feature));
}

/**
 * Whether a capability list satisfies every hard requirement for a feature.
 * The same rule as {@link meetsRequirements}, for models that are not in the
 * registry and so have no {@link AiModelSpec} (catalogue and custom ids).
 */
export function capabilitiesMeetRequirements(
  capabilities: readonly AiCapability[],
  feature: AiFeature,
): boolean {
  return AI_FEATURE_REQUIREMENTS[feature].every((c) =>
    capabilities.includes(c),
  );
}

/** The features a capability list can serve, in feature order. */
export function featuresServedBy(
  capabilities: readonly AiCapability[],
): AiFeature[] {
  return (Object.keys(AI_FEATURE_REQUIREMENTS) as AiFeature[]).filter(
    (feature) => capabilitiesMeetRequirements(capabilities, feature),
  );
}
