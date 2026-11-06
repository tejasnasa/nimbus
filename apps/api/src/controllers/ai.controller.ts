/**
 * @module api/controllers/ai
 * @description Workspace AI REST controllers: status, credential CRUD,
 * per-feature preferences, settings, the call-log usage view, the caller's free
 * allowance, and the model-picker support routes.
 *
 * Thin by design — every action delegates to `lib/ai/*` (resolver, quota,
 * credentialCrypto, probe, spendCap, callLog). The controller's own logic is
 * the permission and projection rules that are not the resolver's concern:
 *
 *   - **Workspace scoping.** Every route but `getFreeUsage` goes through
 *     `requireWorkspaceRole`: a non-member gets 404, a member below the needed
 *     role gets 403. Keys, preferences-writes, settings-writes, usage and the
 *     picker's catalogue and probe need ADMIN; status, the preference list and
 *     the settings read need only membership.
 *   - **Preference↔credential consistency.** Saving a preference for a
 *     provider the workspace has no verified key for is a 422, not a 500. The
 *     resolver would fall through to a different provider, which is the
 *     silent substitution this endpoint exists to prevent.
 *   - **Capability gating on preference save.** Picking a model that lacks
 *     the feature's hard requirements is a 422, not a 503. The admin picked
 *     the wrong thing; the controller refuses at the form rather than at
 *     the next call site.
 *
 * @important Save only on a successful probe. A probe failure throws an
 *            `AiProbeFailedError` which the controller maps to a 400; the
 *            credentials table is unchanged in that case. The pattern is
 *            intentionally `throw` rather than return: a successful probe +
 *            a DB upsert failure surfaces as a 500 (the admin's data was lost)
 *            while a failed probe surfaces as a 400 (the admin can fix it).
 *
 * @important No response from this module may carry `keyEnvelope`, `keyId` or
 *            `keyFingerprint`. DTOs are built field by field, never by
 *            spreading a row, so a column added to a table later is not exposed
 *            by accident.
 */
import { prisma } from "@nimbus/db";
import {
  AI_DEFAULT_VOICE,
  AI_FEATURES,
  AI_FEATURE_KIND,
  AI_FEATURE_REQUIREMENTS,
  AI_PROVIDERS,
  ServerResponse,
  capabilitiesMeetRequirements,
  featuresServedBy,
  meetsRequirements,
  modelById,
  providerHasKind,
  type AiCallDTO,
  type AiCapability,
  type AiCatalogDTO,
  type AiCredentialDTO,
  type AiCredentialSaveDTO,
  type AiFeature,
  type AiFeatureStatus,
  type AiFreeAllowanceDTO,
  type AiFreeState,
  type AiFreeUsageDTO,
  type AiModelKind,
  type AiModelSource,
  type AiPreferenceDTO,
  type AiProbeResultDTO,
  type AiProviderId,
  type AiUsageDTO,
  type AiWorkspaceSettingsDTO,
  type AiWorkspaceStatusDTO,
} from "@nimbus/types";
import { selectModelForFeature } from "@nimbus/utils";
import {
  buildAad,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  maskSecret,
} from "../lib/ai/credentialCrypto";
import { loadWorkspaceAiViews } from "../lib/ai/entitlements";
import {
  getOpenRouterCatalog,
  CatalogUnavailableError,
} from "../lib/ai/openrouterCatalog";
import {
  probeModel,
  probeCacheKey,
  PROBE_CACHE_TTL_SECONDS,
} from "../lib/ai/modelProbe";
import { probeCredential } from "../lib/ai/probe";
import { freeTier as readFreeTierEnv, freeVoiceTier } from "../lib/ai/providers";
import {
  readQuotaState,
  readVoiceQuotaState,
} from "../lib/ai/quota";
import {
  isOverCap,
  monthKey,
  monthStart,
  monthToDateCostUsd,
} from "../lib/ai/spendCap";
import { voiceAvailability } from "../lib/ai/voiceAvailability";
import { readWorkspaceAiSettings } from "../lib/ai/workspaceSettings";
import { pubClient } from "../lib/redis";
import { requireWorkspaceRole } from "../lib/workspaceAccess";

/** A thrown signal for "the probe refused". Caught by the controller to
 *  emit a 400 with the probe's curated message; the credentials table is
 *  untouched. */
export class AiProbeFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProbeFailedError";
  }
}

/** The upper-case form the database enum stores. */
const toDbFeature = (feature: AiFeature) =>
  feature.toUpperCase() as Uppercase<AiFeature>;

/** The row fields a credential DTO is built from. */
type CredentialRow = {
  providerId: string;
  label: string | null;
  maskedPreview: string;
  validatedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  verifiedKinds: string[];
};

/** Projects a credential row onto its DTO, field by field. */
function toCredentialDTO(row: CredentialRow): AiCredentialDTO {
  return {
    providerId: row.providerId,
    label: row.label ?? null,
    maskedPreview: row.maskedPreview,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    verifiedKinds: row.verifiedKinds as AiModelKind[],
  };
}

/** The row fields a preference DTO is built from. */
type PreferenceRow = {
  feature: string;
  providerId: string;
  modelId: string;
  modelSource: string;
  modelCapabilities: string[];
  voice: string | null;
};

/**
 * Projects a preference row onto its DTO. Capabilities are only exposed for
 * non-registry models: for a registry model the registry is the source, and a
 * stored copy would only go stale.
 */
function toPreferenceDTO(row: PreferenceRow): AiPreferenceDTO {
  const modelSource = row.modelSource as AiModelSource;
  return {
    feature: row.feature.toLowerCase() as AiFeature,
    providerId: row.providerId,
    modelId: row.modelId,
    modelSource,
    modelCapabilities:
      modelSource === "registry"
        ? []
        : (row.modelCapabilities as AiCapability[]),
    voice: row.voice,
  };
}

/** `Record<feature, null>` to fill from rows. */
function emptyPreferenceMap(): Record<AiFeature, AiPreferenceDTO | null> {
  return Object.fromEntries(AI_FEATURES.map((f) => [f, null])) as Record<
    AiFeature,
    AiPreferenceDTO | null
  >;
}

/** The free-tier state for a document allowance. */
function freeState(configured: boolean, exhausted: boolean): AiFreeState {
  if (!configured) return "unconfigured";
  return exhausted ? "exhausted" : "available";
}

/** Builds the caller's free allowances. */
async function buildFreeAllowance(userId: string): Promise<AiFreeAllowanceDTO> {
  const [docs, voice] = await Promise.all([
    readQuotaState(userId),
    readVoiceQuotaState(userId),
  ]);
  return {
    docsRemaining: docs.remaining,
    docsLimit: docs.limit,
    voiceSecondsRemaining: voice.remaining,
    voiceSecondsLimit: voice.limit,
    docsState: freeState(Boolean(process.env.AI_API_KEY), docs.exhausted),
    voiceState: freeState(freeVoiceTier() !== null, voice.exhausted),
  };
}

/**
 * Builds the status payload for the workspace and the calling member.
 *
 * Each text feature's `enabled` comes from the same selection the resolver
 * runs, so the composer is never enabled for a request the resolver will refuse
 * — with one exception: a free-tier document allowance spent after this read.
 *
 * @param userId - Authenticated user.
 * @param workspaceId - The workspace.
 * @returns The status envelope, or 404 for a non-member.
 */
export const getWorkspaceAiStatus = async (
  userId: string,
  workspaceId: string,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId, "MEMBER");
    if (!access.ok) return access.response;

    const [views, free, voice, overCap] = await Promise.all([
      loadWorkspaceAiViews(workspaceId),
      buildFreeAllowance(userId),
      voiceAvailability({ workspaceId, userId }),
      isOverCap(workspaceId),
    ]);

    const freeTier = readFreeTierEnv();
    const features = {} as Record<AiFeature, AiFeatureStatus>;

    for (const feature of AI_FEATURES) {
      const preference = views.preferenceViews.find((p) => p.feature === feature);
      const base = {
        providerId: preference?.providerId ?? null,
        modelId: preference?.modelId ?? null,
      };

      if (AI_FEATURE_KIND[feature] !== "text") {
        const on = feature === "transcription" ? voice.available : voice.speaks;
        features[feature] = {
          enabled: on,
          ...base,
          substituted: false,
          reason: on ? null : (voice.reason ?? "no-key"),
        };
        continue;
      }

      const selection = selectModelForFeature(
        feature,
        views.preferenceViews,
        views.credentialViews,
        freeTier,
      );

      if (!("source" in selection)) {
        features[feature] = {
          enabled: false,
          ...base,
          substituted: false,
          reason: selection.reason === "no-key" && !freeTier ? "no-operator-key" : selection.reason,
        };
        continue;
      }
      if (selection.source === "byok" && overCap) {
        features[feature] = {
          enabled: false,
          ...base,
          substituted: false,
          reason: "spend-cap-reached",
        };
        continue;
      }
      // Documents on the free tier additionally need the caller's allowance.
      const documentFeature = feature === "markdown" || feature === "canvas";
      if (selection.source === "free" && documentFeature && free.docsState !== "available") {
        features[feature] = {
          enabled: false,
          ...base,
          substituted: false,
          reason: "free-tier-exhausted",
        };
        continue;
      }
      features[feature] = {
        enabled: true,
        ...base,
        substituted: selection.substituted,
        reason: null,
      };
    }

    const dto: AiWorkspaceStatusDTO = {
      features,
      voice,
      free,
      canManage: access.role !== "MEMBER",
    };
    return ServerResponse.ok(dto);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Lists the workspace's saved credentials.
 *
 * @param userId - Authenticated user; must be an admin or owner.
 * @param workspaceId - The workspace.
 * @returns The credentials, oldest first; 404 for a non-member, 403 for a member.
 */
export const listWorkspaceAiCredentials = async (
  userId: string,
  workspaceId: string,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId, "ADMIN");
    if (!access.ok) return access.response;

    const rows = await prisma.workspaceAiCredential.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    });
    return ServerResponse.ok(rows.map(toCredentialDTO));
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Saves a credential for the workspace, replacing any row for the same provider.
 *
 * The flow is: probe every kind the provider has, in parallel → upsert. A failed
 * primary probe throws an {@link AiProbeFailedError} with a curated message; the
 * controller maps it to a 400 and the table is untouched. A failed audio probe
 * does not block the save: the response carries a `warnings` entry and the kind
 * is left out of `verifiedKinds`.
 *
 * @param userId - Authenticated user; must be an admin or owner.
 * @param workspaceId - The workspace.
 * @param providerId - Provider the credential is for.
 * @param apiKey - Plaintext API key from the request body.
 * @param label - Optional label.
 * @returns `created` for a new row, `ok` for a replacement, 400 on a failed
 *          probe, 404/403 on access.
 */
export const upsertWorkspaceAiCredential = async (
  userId: string,
  workspaceId: string,
  providerId: string,
  apiKey: string,
  label?: string,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId, "ADMIN");
    if (!access.ok) return access.response;

    const provider = AI_PROVIDERS[providerId as AiProviderId];
    if (!provider) return ServerResponse.badRequest("Unknown provider");

    const probe = await probeCredential(provider, apiKey);
    if (!probe.ok) throw new AiProbeFailedError(probe.message);

    const keyEnvelope = encryptSecret(
      apiKey,
      buildAad({ kind: "workspace", workspaceId }, providerId),
    );
    const keyId = keyEnvelope.split(".")[1] ?? "";
    const keyFingerprint = fingerprintSecret(apiKey);
    const maskedPreview = maskSecret(apiKey);
    const validatedAt = new Date();

    const existing = await prisma.workspaceAiCredential.findUnique({
      where: { workspaceId_providerId: { workspaceId, providerId } },
      select: { id: true },
    });

    const row = await prisma.workspaceAiCredential.upsert({
      where: { workspaceId_providerId: { workspaceId, providerId } },
      create: {
        workspaceId,
        providerId,
        keyEnvelope,
        keyId,
        keyFingerprint,
        maskedPreview,
        verifiedKinds: probe.verifiedKinds,
        validatedAt,
        label: label ?? null,
        createdById: userId,
      },
      update: {
        keyEnvelope,
        keyId,
        keyFingerprint,
        maskedPreview,
        verifiedKinds: probe.verifiedKinds,
        validatedAt,
        label: label ?? null,
      },
    });

    const dto: AiCredentialSaveDTO = {
      ...toCredentialDTO(row),
      warnings: probe.warnings,
    };
    const note =
      probe.warnings.length > 0 ? ` ${probe.warnings.join(" ")}` : "";

    return existing
      ? ServerResponse.ok(dto, `Credential updated.${note}`)
      : ServerResponse.created(dto, `Credential saved.${note}`);
  } catch (error) {
    if (error instanceof AiProbeFailedError) {
      return ServerResponse.badRequest(error.message);
    }
    return ServerResponse.internalError(error);
  }
};

/**
 * Removes a credential and the preferences that pointed at its provider.
 *
 * The preferences are removed in the same call so the saved choices do not
 * silently point at a provider whose key is gone. The response reports the
 * count so the UI can show "also removed 2 preferences".
 *
 * @param userId - Authenticated user; must be an admin or owner.
 * @param workspaceId - The workspace.
 * @param providerId - Provider whose credential to remove.
 * @returns 200 with `{ clearedPreferences }`; 404 when there is no such row.
 */
export const deleteWorkspaceAiCredential = async (
  userId: string,
  workspaceId: string,
  providerId: string,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId, "ADMIN");
    if (!access.ok) return access.response;

    const existing = await prisma.workspaceAiCredential.findUnique({
      where: { workspaceId_providerId: { workspaceId, providerId } },
      select: { id: true },
    });
    if (!existing) return ServerResponse.notFound("Credential not found");

    const [{ count: clearedPreferences }] = await prisma.$transaction([
      prisma.workspaceAiPreference.deleteMany({
        where: { workspaceId, providerId },
      }),
      prisma.workspaceAiCredential.delete({
        where: { workspaceId_providerId: { workspaceId, providerId } },
      }),
    ]);

    return ServerResponse.ok({ clearedPreferences }, "Credential removed");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Lists the workspace's saved per-feature preferences.
 *
 * @param userId - Authenticated user; any member.
 * @param workspaceId - The workspace.
 * @returns A `{ feature → preference | null }` map.
 */
export const listWorkspaceAiPreferences = async (
  userId: string,
  workspaceId: string,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId, "MEMBER");
    if (!access.ok) return access.response;

    const rows = await prisma.workspaceAiPreference.findMany({
      where: { workspaceId },
    });
    const result = emptyPreferenceMap();
    for (const row of rows) {
      const dto = toPreferenceDTO(row);
      result[dto.feature] = dto;
    }
    return ServerResponse.ok(result);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Looks up a still-fresh probe result for a custom id, or null.
 *
 * Results live ten minutes under `ai:probe:<workspaceId>:<provider>:<model>`, so
 * the save that follows a "Check model" click does not pay for a second round of
 * provider calls, while a stale answer cannot outlive the window.
 */
async function readCachedProbe(
  workspaceId: string,
  providerId: string,
  modelId: string,
): Promise<AiCapability[] | null> {
  try {
    const raw = await pubClient.get(
      probeCacheKey(workspaceId, providerId, modelId),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { capabilities?: AiCapability[] };
    return Array.isArray(parsed.capabilities) ? parsed.capabilities : null;
  } catch {
    return null;
  }
}

/**
 * Decrypts the workspace's key for a provider and measures `modelId` with it.
 *
 * @returns `credential-missing` when the workspace has no text-verified key for
 *          the provider, the probe's curated refusal, or the measured
 *          capabilities (also cached for ten minutes).
 */
async function measureModel(
  workspaceId: string,
  providerId: string,
  modelId: string,
): Promise<
  | { kind: "credential-missing" }
  | { kind: "refused"; message: string }
  | { kind: "ok"; capabilities: AiCapability[] }
> {
  const provider = AI_PROVIDERS[providerId as AiProviderId];
  const credential = await prisma.workspaceAiCredential.findUnique({
    where: { workspaceId_providerId: { workspaceId, providerId } },
    select: { keyEnvelope: true },
  });
  if (!provider || !credential) return { kind: "credential-missing" };

  let apiKey: string;
  try {
    apiKey = decryptSecret(
      credential.keyEnvelope,
      buildAad({ kind: "workspace", workspaceId }, providerId),
    );
  } catch {
    return {
      kind: "refused",
      message:
        "The workspace's stored credential could not be read. An admin needs to add it again.",
    };
  }

  const result = await probeModel(provider, apiKey, modelId);
  if (!result.ok) return { kind: "refused", message: result.message };

  await pubClient
    .set(
      probeCacheKey(workspaceId, providerId, modelId),
      JSON.stringify({ capabilities: result.capabilities }),
      "EX",
      PROBE_CACHE_TTL_SECONDS,
    )
    .catch(() => undefined);
  return { kind: "ok", capabilities: result.capabilities };
}

/**
 * Measures a model id with the workspace's own credential for the provider.
 *
 * @param userId - Authenticated user; must be an admin or owner.
 * @param workspaceId - The workspace.
 * @param providerId - Provider the id belongs to.
 * @param modelId - The id to measure.
 * @returns 200 with the measured capabilities and the features they serve;
 *          422 when the workspace has no key for the provider; 400 with the
 *          probe's curated reason when the id is rejected.
 */
export const probeWorkspaceAiModel = async (
  userId: string,
  workspaceId: string,
  providerId: string,
  modelId: string,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId, "ADMIN");
    if (!access.ok) return access.response;

    const measured = await measureModel(workspaceId, providerId, modelId);
    if (measured.kind === "credential-missing") {
      return ServerResponse.unprocessableEntity(
        "No credential saved for that provider. Add an API key first.",
      );
    }
    if (measured.kind === "refused") {
      return ServerResponse.badRequest(measured.message);
    }

    const dto: AiProbeResultDTO = {
      capabilities: measured.capabilities,
      servesFeatures: featuresServedBy(measured.capabilities),
    };
    return ServerResponse.ok(dto, "Model checked");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * The OpenRouter catalogue, filtered to models that meet a feature's hard
 * requirements, with the registry's own picks first and then by name.
 *
 * @param userId - Authenticated user; must be an admin or owner.
 * @param workspaceId - The workspace the picker is open in.
 * @param feature - Optional feature to filter for; absent returns every model.
 * @returns 200 with the catalogue, or 503 when it cannot be reached and nothing
 *          is cached.
 */
export const getOpenRouterCatalogForFeature = async (
  userId: string,
  workspaceId: string,
  feature?: AiFeature,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId, "ADMIN");
    if (!access.ok) return access.response;

    const { models, stale } = await getOpenRouterCatalog(pubClient);
    const curated = new Set(AI_PROVIDERS.openrouter.models.map((m) => m.id));

    const dto: AiCatalogDTO = {
      providerId: "openrouter",
      stale,
      models: models
        .filter(
          (m) =>
            !feature || capabilitiesMeetRequirements(m.capabilities, feature),
        )
        .map((m) => ({ ...m, curated: curated.has(m.id) }))
        .sort(
          (a, b) =>
            Number(b.curated) - Number(a.curated) ||
            a.label.localeCompare(b.label),
        ),
    };
    return ServerResponse.ok(dto);
  } catch (error) {
    if (error instanceof CatalogUnavailableError) {
      return ServerResponse.serviceUnavailable(
        "The OpenRouter model list is unavailable right now. Try again shortly.",
      );
    }
    return ServerResponse.internalError(error);
  }
};

/**
 * Saves a per-feature preference for the workspace.
 *
 * Failure cases the controller enforces that the resolver cannot:
 *
 *   - **Unknown provider**: 422 (the registry does not list it).
 *   - **No verified key for the provider and kind**: 422. The resolver would
 *     silently fall through to another credential, which is the substitution
 *     this endpoint exists to prevent.
 *   - **Unknown or incapable model**: 422. Where the capabilities come from
 *     depends on `source`:
 *       - `registry`: the curated spec (the only source for audio features);
 *       - `catalog`: the id must be in the (cached) OpenRouter catalogue, and
 *         the capabilities are the server's copy of its entry;
 *       - `custom`: the capabilities are measured by a probe, or read from a
 *         probe result under ten minutes old.
 *   - **A voice**: accepted only for `speech`, and only one the model lists.
 *
 * @important Capabilities are never taken from the request. A client that sends
 *            them is ignored, because a saved capability set is what the
 *            resolver trusts instead of the registry.
 *
 * @param userId - Authenticated user; must be an admin or owner.
 * @param workspaceId - The workspace.
 * @param feature - Which call site the preference applies to.
 * @param providerId - Provider to use.
 * @param modelId - Model id within that provider.
 * @param source - Where the model id came from; defaults to `registry`.
 * @param voice - Speech voice, for the `speech` feature only.
 * @returns 200 with the saved DTO, 422 on the cases above, 400 when a custom id
 *          is rejected by the probe, 503 when the catalogue is unreachable.
 */
export const upsertWorkspaceAiPreference = async (
  userId: string,
  workspaceId: string,
  feature: AiFeature,
  providerId: string,
  modelId: string,
  source: AiModelSource = "registry",
  voice?: string,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId, "ADMIN");
    if (!access.ok) return access.response;

    const provider = AI_PROVIDERS[providerId as AiProviderId];
    if (!provider) {
      return ServerResponse.unprocessableEntity(
        `Unknown provider: ${providerId}`,
      );
    }

    const kind = AI_FEATURE_KIND[feature];

    if (kind !== "text" && source !== "registry") {
      return ServerResponse.unprocessableEntity(
        "Voice models come from the curated list only.",
      );
    }
    if (voice !== undefined && feature !== "speech") {
      return ServerResponse.unprocessableEntity(
        "Only the speech feature takes a voice.",
      );
    }

    const credential = await prisma.workspaceAiCredential.findUnique({
      where: { workspaceId_providerId: { workspaceId, providerId } },
      select: { verifiedKinds: true },
    });
    if (!credential || !providerHasKind(provider, kind)) {
      return ServerResponse.unprocessableEntity(
        `No credential saved for provider '${provider.label}'. Add an API key first.`,
      );
    }
    if (!credential.verifiedKinds.includes(kind)) {
      return ServerResponse.unprocessableEntity(
        `The '${provider.label}' key has not been verified for ${kind} models.`,
      );
    }

    // Capabilities to store; empty for a registry model, which the registry
    // describes by itself.
    let capabilities: AiCapability[] = [];
    let chosenVoice: string | null = null;

    if (source === "registry") {
      const model = modelById(provider, modelId);
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
      if (feature === "speech") {
        const voices = model.voices ?? [AI_DEFAULT_VOICE];
        chosenVoice = voice ?? voices[0] ?? AI_DEFAULT_VOICE;
        if (!voices.includes(chosenVoice)) {
          return ServerResponse.unprocessableEntity(
            `Model '${modelId}' has no voice '${chosenVoice}'.`,
          );
        }
      }
    } else if (source === "catalog") {
      if (providerId !== "openrouter") {
        return ServerResponse.unprocessableEntity(
          "Only OpenRouter has a model catalogue.",
        );
      }
      const { models } = await getOpenRouterCatalog(pubClient);
      const entry = models.find((m) => m.id === modelId);
      if (!entry) {
        return ServerResponse.unprocessableEntity(
          `Model '${modelId}' is not in the OpenRouter catalogue.`,
        );
      }
      capabilities = entry.capabilities;
    } else {
      capabilities =
        (await readCachedProbe(workspaceId, providerId, modelId)) ?? [];
      if (capabilities.length === 0) {
        const measured = await measureModel(workspaceId, providerId, modelId);
        if (measured.kind === "credential-missing") {
          return ServerResponse.unprocessableEntity(
            `No credential saved for provider '${provider.label}'. Add an API key first.`,
          );
        }
        if (measured.kind === "refused") {
          return ServerResponse.badRequest(measured.message);
        }
        capabilities = measured.capabilities;
      }
    }

    if (
      source !== "registry" &&
      !capabilitiesMeetRequirements(capabilities, feature)
    ) {
      const missing = AI_FEATURE_REQUIREMENTS[feature].filter(
        (c) => !capabilities.includes(c),
      );
      return ServerResponse.unprocessableEntity(
        `Model '${modelId}' does not support ${feature}: it lacks ${missing.join(" and ")}.`,
      );
    }

    const dbFeature = toDbFeature(feature);
    const row = await prisma.workspaceAiPreference.upsert({
      where: { workspaceId_feature: { workspaceId, feature: dbFeature } },
      create: {
        workspaceId,
        feature: dbFeature,
        providerId,
        modelId,
        modelSource: source,
        modelCapabilities: capabilities,
        voice: chosenVoice,
        updatedById: userId,
      },
      update: {
        providerId,
        modelId,
        modelSource: source,
        modelCapabilities: capabilities,
        voice: chosenVoice,
        updatedById: userId,
      },
    });

    return ServerResponse.ok(toPreferenceDTO(row), "Preference saved");
  } catch (error) {
    if (error instanceof CatalogUnavailableError) {
      return ServerResponse.serviceUnavailable(
        "The OpenRouter model list is unavailable right now. Try again shortly.",
      );
    }
    return ServerResponse.internalError(error);
  }
};

/** Builds the settings DTO for a workspace. */
async function buildSettingsDTO(
  workspaceId: string,
): Promise<AiWorkspaceSettingsDTO> {
  const [settings, spent] = await Promise.all([
    readWorkspaceAiSettings(workspaceId),
    monthToDateCostUsd(workspaceId),
  ]);
  return {
    monthlySpendCapUsd: settings.monthlySpendCapUsd,
    assistantEnabled: settings.assistantEnabled,
    assistantSpeaks: settings.assistantSpeaks,
    monthToDateCostUsd: spent,
  };
}

/**
 * Reads the workspace's AI settings and its month-to-date spend.
 *
 * @param userId - Authenticated user; any member.
 * @param workspaceId - The workspace.
 */
export const getWorkspaceAiSettings = async (
  userId: string,
  workspaceId: string,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId, "MEMBER");
    if (!access.ok) return access.response;
    return ServerResponse.ok(await buildSettingsDTO(workspaceId));
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/** The fields a settings update may carry. */
export type SettingsUpdate = {
  monthlySpendCapUsd?: number | null;
  assistantEnabled?: boolean;
  assistantSpeaks?: boolean;
};

/**
 * Updates the workspace's AI settings. Fields left out are unchanged;
 * `monthlySpendCapUsd: null` removes the cap.
 *
 * @param userId - Authenticated user; must be an admin or owner.
 * @param workspaceId - The workspace.
 * @param update - The fields to change.
 */
export const updateWorkspaceAiSettings = async (
  userId: string,
  workspaceId: string,
  update: SettingsUpdate,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId, "ADMIN");
    if (!access.ok) return access.response;

    const data = {
      ...(update.monthlySpendCapUsd !== undefined && {
        monthlySpendCapUsd: update.monthlySpendCapUsd,
      }),
      ...(update.assistantEnabled !== undefined && {
        assistantEnabled: update.assistantEnabled,
      }),
      ...(update.assistantSpeaks !== undefined && {
        assistantSpeaks: update.assistantSpeaks,
      }),
    };
    await prisma.workspaceAiSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    });

    return ServerResponse.ok(await buildSettingsDTO(workspaceId), "Settings saved");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/** Filters a usage query accepts. */
export type UsageQuery = {
  cursor?: string;
  limit: number;
  feature?: AiFeature;
  status?: "ok" | "error" | "refused" | "cancelled";
  userId?: string;
};

/** Splits a `<createdAt ISO>_<id>` cursor, or null when it is malformed. */
function parseCursor(cursor: string): { at: Date; id: string } | null {
  const sep = cursor.indexOf("_");
  if (sep <= 0) return null;
  const at = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || id.length === 0) return null;
  return { at, id };
}

/**
 * Pages through the workspace's call log, newest first, with this UTC month's
 * totals per feature.
 *
 * @param userId - Authenticated user; must be an admin or owner.
 * @param workspaceId - The workspace.
 * @param query - Cursor, page size and filters.
 * @returns The page, the next cursor (null on the last page) and the totals.
 */
export const getWorkspaceAiUsage = async (
  userId: string,
  workspaceId: string,
  query: UsageQuery,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId, "ADMIN");
    if (!access.ok) return access.response;

    let cursor: { at: Date; id: string } | null = null;
    if (query.cursor !== undefined) {
      cursor = parseCursor(query.cursor);
      if (!cursor) return ServerResponse.badRequest("Invalid cursor");
    }

    const filters = {
      workspaceId,
      ...(query.feature && { feature: toDbFeature(query.feature) }),
      ...(query.status && {
        status: query.status.toUpperCase() as "OK" | "ERROR" | "REFUSED" | "CANCELLED",
      }),
      ...(query.userId && { userId: query.userId }),
    };

    const now = new Date();
    const [rows, grouped] = await Promise.all([
      prisma.aiCall.findMany({
        where: {
          ...filters,
          ...(cursor && {
            OR: [
              { createdAt: { lt: cursor.at } },
              { createdAt: cursor.at, id: { lt: cursor.id } },
            ],
          }),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        include: { user: { select: { name: true } } },
      }),
      prisma.aiCall.groupBy({
        by: ["feature"],
        where: { workspaceId, createdAt: { gte: monthStart(now) } },
        _sum: { costUsd: true, audioSeconds: true },
        _count: { _all: true },
      }),
    ]);

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > query.limit && last
        ? `${last.createdAt.toISOString()}_${last.id}`
        : null;

    const calls: AiCallDTO[] = page.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      userId: r.userId,
      userName: r.user?.name ?? null,
      feature: r.feature.toLowerCase() as AiFeature,
      providerId: r.providerId,
      modelId: r.modelId,
      source: r.source === "BYOK" ? "byok" : "free",
      status: r.status.toLowerCase() as AiCallDTO["status"],
      errorReason: r.errorReason,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      reasoningTokens: r.reasoningTokens,
      audioSeconds: r.audioSeconds,
      characters: r.characters,
      latencyMs: r.latencyMs,
      costUsd: r.costUsd === null ? null : Number(r.costUsd),
    }));

    const byFeature = grouped.map((g) => ({
      feature: g.feature.toLowerCase() as AiFeature,
      calls: g._count._all,
      costUsd: g._sum.costUsd ? Number(g._sum.costUsd) : 0,
      audioSeconds: g._sum.audioSeconds ?? 0,
    }));

    const dto: AiUsageDTO = {
      calls,
      nextCursor,
      totals: {
        month: monthKey(now),
        byFeature,
        totalCostUsd: byFeature.reduce((sum, f) => sum + f.costUsd, 0),
        totalCalls: byFeature.reduce((sum, f) => sum + f.calls, 0),
      },
    };
    return ServerResponse.ok(dto);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * The caller's own free allowances, and the workspaces they administer (where
 * a key would lift the limits).
 *
 * @param userId - Authenticated user.
 */
export const getFreeUsage = async (userId: string) => {
  try {
    const [allowance, memberships] = await Promise.all([
      buildFreeAllowance(userId),
      prisma.workspaceMember.findMany({
        where: { userId, role: { in: ["OWNER", "ADMIN"] } },
        select: { workspace: { select: { id: true, slugId: true, name: true } } },
        orderBy: { joinedAt: "asc" },
      }),
    ]);

    const dto: AiFreeUsageDTO = {
      ...allowance,
      adminWorkspaces: memberships.map((m) => ({
        id: m.workspace.id,
        slugId: m.workspace.slugId,
        name: m.workspace.name,
      })),
    };
    return ServerResponse.ok(dto);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};
