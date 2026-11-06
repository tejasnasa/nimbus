/**
 * @module validations/ai
 * @description Zod schemas for the workspace AI REST surface.
 *
 * `providerId` is constrained to the registry's known set via
 * `AI_PROVIDER_IDS` so an unregistered provider is rejected at the edge —
 * before the controller can pick it up and try to construct a client.
 *
 * `feature` is the lowercase form the resolver uses; the database enum is
 * uppercase, and the controller's job is to translate between the two so
 * the rest of the codebase does not see the difference.
 */
import { z } from "zod";
import { AI_FEATURES, AI_MODEL_SOURCES, AI_PROVIDER_IDS } from "../ai/providers";

/** Provider id constrained to the registry. */
export const aiProviderIdSchema = z.enum(AI_PROVIDER_IDS);

/** The AI features, in the lowercase form the resolver uses. */
export const aiFeatureSchema = z.enum(AI_FEATURES);

/** Path params for every `/api/ai/workspaces/:workspaceId/*` route. */
export const aiWorkspaceParamsSchema = z.object({
  workspaceId: z.string().min(1).max(64),
});

/** Payload for POST /api/ai/workspaces/:workspaceId/credentials. */
export const aiCredentialCreateSchema = z.object({
  providerId: aiProviderIdSchema,
  apiKey: z
    .string()
    .min(1, "API key is required")
    .max(512, "API key is too long"),
  // `label` is optional. Empty strings — which RHF normalises a missing
  // optional field into on the wire — are coerced to `undefined` so they
  // pass through as "no label". A present label is still bounded to 1-64
  // characters.
  label: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(1).max(64, "Label must be at most 64 characters").optional(),
  ),
});

/** Where a saved model came from. */
export const aiModelSourceSchema = z.enum(AI_MODEL_SOURCES);

/**
 * Payload for PUT /api/ai/workspaces/:workspaceId/preferences.
 *
 * There is deliberately no `capabilities` field. For a catalogue or custom model
 * the server copies or measures them itself; anything a client sends under that
 * name is not read.
 */
export const aiPreferenceSchema = z.object({
  feature: aiFeatureSchema,
  providerId: aiProviderIdSchema,
  modelId: z.string().min(1).max(128),
  source: aiModelSourceSchema.optional(),
  /** Speech voice; accepted only for the `speech` feature. */
  voice: z.string().trim().min(1).max(64).optional(),
});

/** Payload for POST /api/ai/workspaces/:workspaceId/models/probe. */
export const aiModelProbeSchema = z.object({
  providerId: aiProviderIdSchema,
  modelId: z.string().trim().min(1, "Model id is required").max(128),
});

/** Query for GET /api/ai/workspaces/:workspaceId/catalog/openrouter. */
export const aiCatalogQuerySchema = z.object({
  feature: aiFeatureSchema.optional(),
});

/**
 * Payload for PUT /api/ai/workspaces/:workspaceId/settings. Every field is
 * optional so a switch can be flipped without restating the cap, but an empty
 * body is refused. `monthlySpendCapUsd: null` removes the cap.
 */
export const aiSettingsSchema = z
  .object({
    monthlySpendCapUsd: z
      .number()
      .positive("The cap must be greater than zero")
      .max(1_000_000, "The cap is too large")
      .multipleOf(0.01, "Use at most two decimal places")
      .nullable()
      .optional(),
    assistantEnabled: z.boolean().optional(),
    assistantSpeaks: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Nothing to update",
  });

/** The call statuses a usage query can filter on. */
export const aiCallStatusSchema = z.enum(["ok", "error", "refused", "cancelled"]);

/** Query for GET /api/ai/workspaces/:workspaceId/usage. */
export const aiUsageQuerySchema = z.object({
  cursor: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  feature: aiFeatureSchema.optional(),
  status: aiCallStatusSchema.optional(),
  userId: z.string().min(1).max(64).optional(),
});
