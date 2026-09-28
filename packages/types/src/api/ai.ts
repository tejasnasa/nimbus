/**
 * @module api/ai
 * @description DTOs for the BYOK REST surface — the shape the web client
 * receives and the resolver refuses with.
 *
 * Two rules drive the design here:
 *
 *   1. The DTO is the **boundary** between encrypted-at-rest and the network.
 *      Nothing that even hints at the plaintext key, the envelope, the key id,
 *      or the key fingerprint crosses the wire. `maskedPreview` is the only
 *      key-adjacent field allowed, because it is designed to be visible to the
 *      user. A leak here would be a type error, not a runtime bug.
 *
 *   2. `AiStatusDTO` is the web's source of truth for the disabled composer
 *      (§7 of the plan). The shape must be answerable even when the encryption
 *      key is missing — `byokAvailable: false` rather than a 503 — because the
 *      chat composer is client-side, and the client needs to know whether to
 *      render the "add a key" affordance without that affordance 503ing on
 *      every render.
 */
import type { AiFeature } from "../ai/providers";

/** A saved credential, returned by the list endpoint. Never carries the key. */
export type AiCredentialDTO = {
  /** Provider the credential is for (e.g. `openai`, `deepseek`). */
  providerId: string;
  /** Optional label the user assigned. */
  label: string | null;
  /** `sk-…4f2a` style preview. Safe to render. */
  maskedPreview: string;
  /** When the save-time probe last confirmed the key. Null = unvalidated. */
  validatedAt: string | null;
  /** ISO timestamp the credential was last persisted. */
  createdAt: string;
  /** ISO timestamp of the most recent successful model call. */
  lastUsedAt: string | null;
};

/** A saved per-feature preference (provider + model). */
export type AiPreferenceDTO = {
  feature: AiFeature;
  providerId: string;
  modelId: string;
};

/**
 * Per-feature UI state. Drives the disabled composer and the docs banner.
 *
 * The `documents` field is split into `markdown` and `canvas` because the two
 * have different capability requirements and a user can have a capable model
 * for one without the other.
 */
export type AiFeatureStatus = {
  /** True when a feature can be served right now. */
  enabled: boolean;
  /** Provider+model the resolver will use. Null = no preference, falls to default. */
  providerId: string | null;
  modelId: string | null;
  /** True when the resolver will substitute the preference's model. */
  substituted: boolean;
};

/** The shape of `GET /api/ai/status`. */
export type AiStatusDTO = {
  /** False when `AI_CREDENTIAL_ENCRYPTION_KEY` is unset — no BYOK surface. */
  byokAvailable: boolean;
  chat: AiFeatureStatus;
  documents: {
    markdown: AiFeatureStatus;
    canvas: AiFeatureStatus;
    /** Free-tier document generations remaining. May be one stale under load. */
    freeRemaining: number;
    /** Total free-tier document generations per user. */
    freeLimit: number;
    /** Whether the free tier is configured at all on this deployment. */
    freeTierState: "available" | "exhausted" | "unconfigured";
  };
  /** The user's saved credentials (masked). Empty when encryption is unconfigured. */
  credentials: AiCredentialDTO[];
  /** The user's saved per-feature preferences. */
  preferences: Record<AiFeature, AiPreferenceDTO | null>;
};
