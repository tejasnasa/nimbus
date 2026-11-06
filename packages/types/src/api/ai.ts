/**
 * @module api/ai
 * @description DTOs for the workspace AI REST surface: the shape the web client
 * receives and the resolver refuses with.
 *
 * Two rules drive the design here:
 *
 *   1. The DTO is the **boundary** between encrypted-at-rest and the network.
 *      Nothing that even hints at the plaintext key, the envelope, the key id,
 *      or the key fingerprint crosses the wire. `maskedPreview` is the only
 *      key-adjacent field allowed, because it is designed to be visible to the
 *      admins who manage the key. A leak here would be a type error, not a
 *      runtime bug.
 *
 *   2. `AiWorkspaceStatusDTO` is the web's source of truth for the disabled
 *      composer. It is always answerable: every field is derived from the
 *      workspace's credentials, preferences and settings and the caller's own
 *      free allowance, so a request never fails because the deployment is
 *      misconfigured.
 */
import type {
  AiCapability,
  AiFeature,
  AiModelKind,
  AiModelSource,
  AiProviderId,
} from "../ai/providers";

/** A saved credential, returned by the list endpoint. Never carries the key. */
export type AiCredentialDTO = {
  /** Provider the credential is for (e.g. `openai`, `deepseek`). */
  providerId: string;
  /** Optional label an admin assigned. */
  label: string | null;
  /** `sk-…4f2a` style preview. Safe to render. */
  maskedPreview: string;
  /** When the save-time probe last confirmed the key. Null = unvalidated. */
  validatedAt: string | null;
  /** ISO timestamp the credential was last persisted. */
  createdAt: string;
  /** ISO timestamp of the most recent successful model call. */
  lastUsedAt: string | null;
  /** Which model kinds the save-time probe confirmed for this key. */
  verifiedKinds: AiModelKind[];
};

/** The shape returned when a credential is saved. */
export type AiCredentialSaveDTO = AiCredentialDTO & {
  /**
   * Curated reasons, one per kind, for audio probes that failed while the key
   * itself was accepted. Empty when every probe passed.
   */
  warnings: string[];
};

/** A saved per-feature preference (provider + model, plus voice for speech). */
export type AiPreferenceDTO = {
  feature: AiFeature;
  providerId: string;
  modelId: string;
  /** Where the model came from. Absent on a client-built save request. */
  modelSource?: AiModelSource;
  /**
   * Capabilities stored with a catalogue or custom preference, for the picker's
   * chips. Always empty for `registry` models (the registry is the source) and
   * never read from a request: the server measures or copies them itself.
   */
  modelCapabilities?: AiCapability[];
  /** Text-to-speech voice. Null for every feature but `speech`. */
  voice?: string | null;
};

/** One OpenRouter catalogue entry, mapped to what the picker needs. */
export type AiCatalogModelDTO = {
  id: string;
  label: string;
  capabilities: AiCapability[];
  /** USD per million tokens, when the catalogue states a non-negative price. */
  pricing: { inputPerMTok: number; outputPerMTok: number } | null;
  contextLength: number | null;
  /** True for models the curated registry also lists; sorted first. */
  curated: boolean;
};

/** The shape of `GET /api/ai/workspaces/:workspaceId/catalog/openrouter`. */
export type AiCatalogDTO = {
  providerId: AiProviderId;
  models: AiCatalogModelDTO[];
  /** True when the live fetch failed and a cached copy was served. */
  stale: boolean;
};

/** The shape of `POST /api/ai/workspaces/:workspaceId/models/probe`. */
export type AiProbeResultDTO = {
  /** The measured capabilities of the model id. */
  capabilities: AiCapability[];
  /** The features the measured set satisfies. */
  servesFeatures: AiFeature[];
};

/** Per-feature UI state. Drives the disabled composer and the docs banner. */
export type AiFeatureStatus = {
  /** True when a feature can be served right now. */
  enabled: boolean;
  /** Provider+model the workspace has chosen. Null = no preference, falls to default. */
  providerId: string | null;
  modelId: string | null;
  /** True when the resolver will substitute the preference's model. */
  substituted: boolean;
  /**
   * Why the feature is off, as a curated code (`no-key`, `no-capable-model`,
   * `spend-cap-reached`, …), or null when it is on.
   */
  reason: string | null;
};

/** Why the in-call assistant cannot run, when it cannot. */
export type AiVoiceUnavailableReason =
  | "assistant-disabled"
  | "no-voice-key"
  | "free-voice-exhausted"
  | "spend-cap-reached";

/** How the operator's free tier stands for the caller. */
export type AiFreeState = "available" | "exhausted" | "unconfigured";

/** The caller's own free allowances. Per user, shared by every workspace. */
export type AiFreeAllowanceDTO = {
  /** Free-tier document generations remaining. May be one stale under load. */
  docsRemaining: number;
  /** Total free-tier document generations per user. */
  docsLimit: number;
  /** Free assistant seconds remaining. */
  voiceSecondsRemaining: number;
  /** Total free assistant seconds per user. */
  voiceSecondsLimit: number;
  /** Document free tier. */
  docsState: AiFreeState;
  /** Assistant free tier. */
  voiceState: AiFreeState;
};

/** The shape of `GET /api/ai/workspaces/:workspaceId/status`. */
export type AiWorkspaceStatusDTO = {
  /** One entry per feature. */
  features: Record<AiFeature, AiFeatureStatus>;
  voice: {
    /** Whether the assistant can run in this workspace for the caller. */
    available: boolean;
    reason: AiVoiceUnavailableReason | null;
    /** Whether replies are spoken rather than posted to chat. */
    speaks: boolean;
  };
  /** The caller's free allowances. */
  free: AiFreeAllowanceDTO;
  /** True when the caller is an admin or owner and may change keys and settings. */
  canManage: boolean;
};

/** A workspace the caller administers, for the account-level Free usage tab. */
export type AiAdminWorkspaceDTO = {
  id: string;
  slugId: number;
  name: string;
};

/** The shape of `GET /api/ai/me/free-usage`. */
export type AiFreeUsageDTO = AiFreeAllowanceDTO & {
  /** Workspaces where the caller is OWNER or ADMIN. */
  adminWorkspaces: AiAdminWorkspaceDTO[];
};

/** The shape of `GET`/`PUT /api/ai/workspaces/:workspaceId/settings`. */
export type AiWorkspaceSettingsDTO = {
  /** Month-to-date spend ceiling in USD. Null means no cap. */
  monthlySpendCapUsd: number | null;
  assistantEnabled: boolean;
  assistantSpeaks: boolean;
  /** Estimated spend so far this UTC month, in USD. Calls with no price count as zero. */
  monthToDateCostUsd: number;
};

/** One row of the call log. */
export type AiCallDTO = {
  id: string;
  /** ISO timestamp. */
  createdAt: string;
  userId: string | null;
  /** The member's display name when the member still exists. */
  userName: string | null;
  feature: AiFeature;
  providerId: string;
  modelId: string;
  source: "byok" | "free";
  status: "ok" | "error" | "refused" | "cancelled";
  /** Curated reason code. Never provider text. */
  errorReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  audioSeconds: number | null;
  characters: number | null;
  latencyMs: number;
  /** Estimated from list prices; null when the model has no price. */
  costUsd: number | null;
};

/** The current UTC month's totals for one feature. */
export type AiUsageFeatureTotal = {
  feature: AiFeature;
  calls: number;
  costUsd: number;
  audioSeconds: number;
};

/** The shape of `GET /api/ai/workspaces/:workspaceId/usage`. */
export type AiUsageDTO = {
  calls: AiCallDTO[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
  totals: {
    /** `yyyy-mm`, UTC. */
    month: string;
    byFeature: AiUsageFeatureTotal[];
    totalCostUsd: number;
    totalCalls: number;
  };
};
