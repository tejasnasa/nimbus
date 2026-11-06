/**
 * @module web/tests/msw/aiFixtures
 * @description Builders for the workspace AI payloads the web tests share: the
 * status, a credential, the settings and a page of the call log. Each takes
 * overrides, so a test states only what it cares about.
 */
import {
  AI_FEATURES,
  type AiCallDTO,
  type AiCredentialDTO,
  type AiFeature,
  type AiFeatureStatus,
  type AiFreeUsageDTO,
  type AiUsageDTO,
  type AiWorkspaceSettingsDTO,
  type AiWorkspaceStatusDTO,
} from "@nimbus/types";

/** A feature that is on and unremarkable. */
export const featureOn = (): AiFeatureStatus => ({
  enabled: true,
  providerId: null,
  modelId: null,
  substituted: false,
  reason: null,
});

/** A feature that is off for `reason`. */
export const featureOff = (reason: string): AiFeatureStatus => ({
  enabled: false,
  providerId: null,
  modelId: null,
  substituted: false,
  reason,
});

/**
 * The workspace status payload.
 *
 * @param overrides - Fields to replace; `features` merges per feature.
 */
export const aiStatus = (
  overrides: {
    features?: Partial<Record<AiFeature, AiFeatureStatus>>;
    canManage?: boolean;
    free?: Partial<AiWorkspaceStatusDTO["free"]>;
    voice?: Partial<AiWorkspaceStatusDTO["voice"]>;
  } = {},
): AiWorkspaceStatusDTO => {
  const features = {} as Record<AiFeature, AiFeatureStatus>;
  for (const feature of AI_FEATURES) {
    features[feature] = overrides.features?.[feature] ?? featureOn();
  }
  return {
    features,
    voice: { available: true, reason: null, speaks: true, ...overrides.voice },
    free: {
      docsRemaining: 5,
      docsLimit: 5,
      voiceSecondsRemaining: 600,
      voiceSecondsLimit: 600,
      docsState: "available",
      voiceState: "available",
      ...overrides.free,
    },
    canManage: overrides.canManage ?? true,
  };
};

/** A status where chat is off for `reason`. */
export const aiStatusChatOff = (
  reason = "no-key",
  canManage = true,
): AiWorkspaceStatusDTO =>
  aiStatus({ features: { chat: featureOff(reason) }, canManage });

/** A saved credential. */
export const credential = (
  overrides: Partial<AiCredentialDTO> = {},
): AiCredentialDTO => ({
  providerId: "openai",
  label: null,
  maskedPreview: "sk-…4f2a",
  validatedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
  verifiedKinds: ["text"],
  ...overrides,
});

/** The workspace AI settings. */
export const aiSettings = (
  overrides: Partial<AiWorkspaceSettingsDTO> = {},
): AiWorkspaceSettingsDTO => ({
  monthlySpendCapUsd: null,
  assistantEnabled: true,
  assistantSpeaks: true,
  monthToDateCostUsd: 0,
  ...overrides,
});

/** The caller's free allowances. */
export const freeUsage = (
  overrides: Partial<AiFreeUsageDTO> = {},
): AiFreeUsageDTO => ({
  docsRemaining: 5,
  docsLimit: 5,
  voiceSecondsRemaining: 600,
  voiceSecondsLimit: 600,
  docsState: "available",
  voiceState: "available",
  adminWorkspaces: [],
  ...overrides,
});

/** One call-log row. */
export const callRow = (overrides: Partial<AiCallDTO> = {}): AiCallDTO => ({
  id: "call-1",
  createdAt: "2026-11-05T10:00:00.000Z",
  userId: "user-1",
  userName: "Ada Lovelace",
  feature: "chat",
  providerId: "openai",
  modelId: "gpt-5-nano",
  source: "byok",
  status: "ok",
  errorReason: null,
  inputTokens: 100,
  outputTokens: 50,
  reasoningTokens: null,
  audioSeconds: null,
  characters: null,
  latencyMs: 420,
  costUsd: 0.0012,
  ...overrides,
});

/** A page of the call log with this month's totals. */
export const usagePage = (
  calls: AiCallDTO[] = [callRow()],
  nextCursor: string | null = null,
): AiUsageDTO => ({
  calls,
  nextCursor,
  totals: {
    month: "2026-11",
    byFeature: [
      { feature: "chat", calls: calls.length, costUsd: 0.0012, audioSeconds: 0 },
    ],
    totalCostUsd: 0.0012,
    totalCalls: calls.length,
  },
});
