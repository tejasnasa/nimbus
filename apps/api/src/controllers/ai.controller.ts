/**
 * @module api/controllers/ai
 * @description BYOK REST controllers: status, credential CRUD, and per-feature
 * preferences.
 *
 * Thin by design — every action delegates to `lib/ai/*` (resolver, quota,
 * credentialCrypto, probe). The controller's only logic is the orchestration
 * required to turn an HTTP request into those primitives and the
 * membership-and-projection rules that are not the resolver's concern:
 *
 *   - **Ownership scoping.** A credential that is not the caller's returns
 *     404, not 403 — same convention as `getWorkspaceBySlugId` for
 *     non-members. The row does not exist for this caller.
 *   - **Preference↔credential consistency.** Saving a preference for a
 *     provider the user has no credential for is a 422, not a 500. The
 *     resolver would fall through to a different provider, which is the
 *     silent substitution this endpoint exists to prevent.
 *   - **Capability gating on preference save.** Picking a model that lacks
 *     the feature's hard requirements is a 422, not a 503. The user picked
 *     the wrong thing; the controller refuses at the form rather than at
 *     the next call site.
 *
 * @important Save only on a successful probe. A probe failure throws an
 *            `AiProbeFailedError` which the controller maps to a 400; the
 *            credentials table is unchanged in that case. The pattern is
 *            intentionally `throw` rather than return: a successful probe +
 *            a DB upsert failure surfaces as a 500 (caller's data was lost)
 *            while a failed probe surfaces as a 400 (the user can fix it).
 */
import { prisma } from "@nimbus/db";
import {
  type AiCredentialDTO,
  type AiFeature,
  type AiPreferenceDTO,
  type AiStatusDTO,
  ServerResponse,
} from "@nimbus/types";
import { AI_PROVIDERS, meetsRequirements } from "@nimbus/types";
import {
  buildAad,
  encryptSecret,
  fingerprintSecret,
  maskSecret,
} from "../lib/ai/credentialCrypto";
import { probeApiKey } from "../lib/ai/probe";
import { readQuotaState } from "../lib/ai/quota";

/** A thrown signal for "the probe refused". Caught by the controller to
 *  emit a 400 with the probe's curated message; the credentials table is
 *  untouched. */
export class AiProbeFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProbeFailedError";
  }
}

/**
 * Builds the status payload for the calling user.
 *
 * @param userId - Authenticated user.
 * @returns The status envelope for the chat composer and the AI settings panel.
 */
export const getAiStatus = async (userId: string) => {
  try {
    const [credentials, preferences, quota] = await Promise.all([
      prisma.aiCredential.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),
      prisma.aiFeaturePreference.findMany({ where: { userId } }),
      readQuotaState(userId),
    ]);

    const credentialDTOs: AiCredentialDTO[] = credentials.map((c) => ({
      providerId: c.providerId,
      label: c.label ?? null,
      maskedPreview: c.maskedPreview,
      validatedAt: c.validatedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    }));

    const prefDTOs: Record<AiFeature, AiPreferenceDTO | null> = {
      chat: null,
      markdown: null,
      canvas: null,
    };
    for (const p of preferences) {
      const feature = p.feature.toLowerCase() as AiFeature;
      prefDTOs[feature] = {
        feature,
        providerId: p.providerId,
        modelId: p.modelId,
      };
    }

    const freeTierConfigured = Boolean(process.env.AI_API_KEY);
    const freeTierState: AiStatusDTO["documents"]["freeTierState"] =
      !freeTierConfigured
        ? "unconfigured"
        : quota.exhausted
          ? "exhausted"
          : "available";

    // A user with any credential has a chat path; without one, the free tier
    // is the path. Both dead means the composer is disabled with a CTA.
    const chatEnabled = credentialDTOs.length > 0 || freeTierConfigured;

    // Documents additionally need the free allowance to be unspent — but only
    // for the user who has no key of their own. A BYOK user is never gated by
    // the free-tier quota, so their documents are enabled regardless.
    const documentsEnabled =
      credentialDTOs.length > 0 || (freeTierConfigured && !quota.exhausted);

    return ServerResponse.ok({
      chat: {
        enabled: chatEnabled,
        providerId: prefDTOs.chat?.providerId ?? null,
        modelId: prefDTOs.chat?.modelId ?? null,
        substituted: false,
      },
      documents: {
        markdown: {
          enabled: documentsEnabled,
          providerId: prefDTOs.markdown?.providerId ?? null,
          modelId: prefDTOs.markdown?.modelId ?? null,
          substituted: false,
        },
        canvas: {
          enabled: documentsEnabled,
          providerId: prefDTOs.canvas?.providerId ?? null,
          modelId: prefDTOs.canvas?.modelId ?? null,
          substituted: false,
        },
        freeRemaining: quota.remaining,
        freeLimit: quota.limit,
        freeTierState,
      },
      credentials: credentialDTOs,
      preferences: prefDTOs,
    });
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Lists the caller's saved credentials.
 *
 * Always scoped to the caller's userId at the DB query level. The DTO
 * shape never carries the plaintext, the envelope, or the key id; see
 * `AiCredentialDTO`.
 *
 * @param userId - Authenticated user.
 * @returns The caller's credentials, oldest first.
 */
export const listAiCredentials = async (userId: string) => {
  try {
    const rows = await prisma.aiCredential.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });

    const dtos: AiCredentialDTO[] = rows.map((c) => ({
      providerId: c.providerId,
      label: c.label ?? null,
      maskedPreview: c.maskedPreview,
      validatedAt: c.validatedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    }));

    return ServerResponse.ok(dtos);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Saves a new credential, replacing any existing row for the same provider.
 *
 * The flow is: probe → upsert. A failed probe throws an
 * {@link AiProbeFailedError} with a curated message; the controller maps it
 * to a 400 and the table is untouched. The upsert uses the unique
 * `(userId, providerId)` constraint, so re-saving for the same provider
 * replaces the row rather than creating a duplicate.
 *
 * @param userId - Authenticated user.
 * @param providerId - Provider the credential is for.
 * @param apiKey - Plaintext API key from the request body.
 * @param label - Optional user-supplied label.
 * @returns `created` for a new row, `ok` for a replacement, 400 on a failed
 *          probe.
 */
export const upsertAiCredential = async (
  userId: string,
  providerId: string,
  apiKey: string,
  label?: string,
) => {
  try {
    // The provider is one of AI_PROVIDER_IDS by the Zod schema, but we look
    // it up to drive the probe — the registry is the source of truth for
    // base URLs and models.
    const provider = AI_PROVIDERS[providerId as keyof typeof AI_PROVIDERS];
    if (!provider) {
      return ServerResponse.badRequest("Unknown provider");
    }

    // Pick the cheapest model that satisfies `tools` (the chat hard
    // requirement). The probe exercises the same request shape as a real
    // call, but a reasoning-capable model is fine to probe with — the
    // effort here is `low`, and `reasoningKwargs` produces the right shape.
    const probeModel =
      provider.models.find((m) => meetsRequirements(m, "chat")) ??
      provider.models[0];
    if (!probeModel) {
      return ServerResponse.badRequest("Provider has no models");
    }

    const probe = await probeApiKey(provider, apiKey, probeModel);
    if (!probe.ok) {
      // The probe refuses; the credentials table is untouched.
      throw new AiProbeFailedError(probe.message);
    }

    const aad = buildAad(userId, providerId);
    const keyEnvelope = encryptSecret(apiKey, aad);
    const keyFingerprint = fingerprintSecret(apiKey);
    const maskedPreview = maskSecret(apiKey);
    const validatedAt = new Date();

    const existing = await prisma.aiCredential.findUnique({
      where: { userId_providerId: { userId, providerId } },
      select: { id: true, createdAt: true },
    });

    const row = await prisma.aiCredential.upsert({
      where: { userId_providerId: { userId, providerId } },
      create: {
        userId,
        providerId,
        keyEnvelope,
        keyId: keyEnvelope.split(".")[1] ?? "",
        keyFingerprint,
        maskedPreview,
        validatedAt,
        label: label ?? null,
      },
      update: {
        keyEnvelope,
        keyId: keyEnvelope.split(".")[1] ?? "",
        keyFingerprint,
        maskedPreview,
        validatedAt,
        label: label ?? null,
      },
    });

    const dto: AiCredentialDTO = {
      providerId: row.providerId,
      label: row.label ?? null,
      maskedPreview: row.maskedPreview,
      validatedAt: row.validatedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    };

    return existing
      ? ServerResponse.ok(dto, "Credential updated")
      : ServerResponse.created(dto, "Credential saved");
  } catch (error) {
    if (error instanceof AiProbeFailedError) {
      return ServerResponse.badRequest(error.message);
    }
    return ServerResponse.internalError(error);
  }
};

/**
 * Removes a credential and the preferences that pointed at it.
 *
 * The preferences table is updated in the same call so the user's saved
 * choices do not silently point at a provider whose key is gone. The
 * response body reports the count of dropped preferences so the UI can
 * show "also removed 2 preferences" rather than guessing.
 *
 * @param userId - Authenticated user.
 * @param providerId - Provider whose credential to remove.
 * @returns 200 with `{ clearedPreferences }`, 404 when the row is not the
 *          caller's (or does not exist at all).
 */
export const deleteAiCredential = async (
  userId: string,
  providerId: string,
) => {
  try {
    const existing = await prisma.aiCredential.findUnique({
      where: { userId_providerId: { userId, providerId } },
      select: { id: true },
    });

    // 404 covers both "not your row" and "no row at all" — same convention
    // as the rest of the API for ownership-scoped reads.
    if (!existing) {
      return ServerResponse.notFound("Credential not found");
    }

    // Drop preferences that pointed at this provider first so the user is
    // not left with a UI state the resolver cannot honour.
    const { count: clearedPreferences } =
      await prisma.aiFeaturePreference.deleteMany({
        where: { userId, providerId },
      });

    await prisma.aiCredential.delete({
      where: { userId_providerId: { userId, providerId } },
    });

    return ServerResponse.ok({ clearedPreferences }, "Credential removed");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Lists the caller's saved per-feature preferences.
 *
 * @param userId - Authenticated user.
 * @returns A `{ feature → preference | null }` map, mirroring the DTO shape
 *          the status endpoint exposes so the picker can hydrate without a
 *          second round-trip.
 */
export const listAiPreferences = async (userId: string) => {
  try {
    const rows = await prisma.aiFeaturePreference.findMany({
      where: { userId },
    });

    const result: Record<AiFeature, AiPreferenceDTO | null> = {
      chat: null,
      markdown: null,
      canvas: null,
    };
    for (const row of rows) {
      const feature = row.feature.toLowerCase() as AiFeature;
      result[feature] = {
        feature,
        providerId: row.providerId,
        modelId: row.modelId,
      };
    }

    return ServerResponse.ok(result);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Saves a per-feature preference.
 *
 * Three failure cases the controller enforces that the resolver cannot:
 *
 *   - **Unknown provider**: 422 (the registry does not list it). A bad
 *     `providerId` here would persist and the resolver would refuse the
 *     next request with a confusing message.
 *   - **Capability mismatch**: 422. A model that lacks the feature's hard
 *     requirements cannot serve the feature; the picker's hard filter
 *     hides these, but the controller's Zod-free path must catch them too
 *     in case a client posts a model id the picker never offered.
 *   - **No credential for the provider**: 422. The resolver would silently
 *     fall through to the user's primary credential, which is the
 *     substitution this endpoint exists to prevent.
 *
 * @param userId - Authenticated user.
 * @param feature - Which call site the preference applies to.
 * @param providerId - Provider the user wants to use.
 * @param modelId - Model id within that provider.
 * @returns 200 with the saved DTO, 422 on the three failure cases above.
 */
export const upsertAiPreference = async (
  userId: string,
  feature: AiFeature,
  providerId: string,
  modelId: string,
) => {
  try {
    // Cast to the resolver-side feature type — the controller accepts the
    // lowercase form from the client and stores it in the upper-case enum.
    const featureEnum = feature.toUpperCase() as "CHAT" | "MARKDOWN" | "CANVAS";

    const provider = AI_PROVIDERS[providerId as keyof typeof AI_PROVIDERS];
    if (!provider) {
      return ServerResponse.unprocessableEntity(
        `Unknown provider: ${providerId}`,
      );
    }

    const model = provider.models.find((m) => m.id === modelId);
    if (!model) {
      return ServerResponse.unprocessableEntity(
        `Unknown model '${modelId}' for provider '${provider.label}'.`,
      );
    }

    if (!meetsRequirements(model, feature)) {
      return ServerResponse.unprocessableEntity(
        `Model '${modelId}' does not support ${feature}.`,
      );
    }

    const credential = await prisma.aiCredential.findUnique({
      where: { userId_providerId: { userId, providerId } },
      select: { id: true },
    });
    if (!credential) {
      return ServerResponse.unprocessableEntity(
        `No credential saved for provider '${provider.label}'. Add an API key first.`,
      );
    }

    const row = await prisma.aiFeaturePreference.upsert({
      where: { userId_feature: { userId, feature: featureEnum } },
      create: { userId, feature: featureEnum, providerId, modelId },
      update: { providerId, modelId },
    });

    return ServerResponse.ok(
      {
        feature,
        providerId: row.providerId,
        modelId: row.modelId,
      },
      "Preference saved",
    );
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};
