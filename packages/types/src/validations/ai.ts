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
import { AI_PROVIDER_IDS } from "../ai/providers";

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
  label: z
    .string()
    .min(1)
    .max(64, "Label must be at most 64 characters")
    .optional(),
});

/** Payload for PUT /api/ai/preferences. */
export const aiPreferenceSchema = z.object({
  feature: aiFeatureSchema,
  providerId: aiProviderIdSchema,
  modelId: z.string().min(1).max(128),
});
