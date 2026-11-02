/**
 * @module validations/ai
 * @description Zod schemas for the BYOK REST surface.
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
import { AI_MODEL_SOURCES, AI_PROVIDER_IDS } from "../ai/providers";

/** Provider id constrained to the registry. */
export const aiProviderIdSchema = z.enum(AI_PROVIDER_IDS);

/** The three AI features, in the lowercase form the resolver uses. */
export const aiFeatureSchema = z.enum(["chat", "markdown", "canvas"]);

/** Payload for POST /api/ai/credentials. */
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
 * Payload for PUT /api/ai/preferences.
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
});

/** Payload for POST /api/ai/models/probe. */
export const aiModelProbeSchema = z.object({
  providerId: aiProviderIdSchema,
  modelId: z.string().trim().min(1, "Model id is required").max(128),
});

/** Query for GET /api/ai/catalog/openrouter. */
export const aiCatalogQuerySchema = z.object({
  feature: aiFeatureSchema.optional(),
});
