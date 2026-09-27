/**
 * @module api/lib/ai/entitlements
 * @description Resolves which AI credential/model serves a given feature for a
 * given user, and returns an {@link AiClientHandle} ready for a call site to
 * use, or a curated refusal.
 *
 * This module composes four things and adds no logic of its own:
 *
 *   1. `packages/utils`'s `selectModelForFeature` — the pure precedence
 *      chain (preference → credential → free tier).
 *   2. `lib/ai/providers` — the registry and the operator's free-tier env
 *      view.
 *   3. `lib/ai/credentialCrypto` — envelope decryption.
 *   4. `lib/ai/clientFactory` — the SDK client construction.
 *
 * The resolver is the only module that combines these — splitting the work
 * keeps every other piece unit-testable without spinning up a DB or an SDK
 * mock, and makes the resolver itself a thin, audited wrapper.
 *
 * @important Two asymmetries that must not be "fixed" without reading this
 *            header again:
 *   - Free-tier capabilities are **assumed**, not enforced — the operator's
 *     free model may not be in the curated registry. The one `warn` log per
 *     process lives here, not in the data module, because logging is a side
 *     effect that does not belong in `selectModelForFeature`.
 *   - `invalid-key` and `provider-error` are produced at *call* time by
 *     `clientFactory.classifyClientError`. This module produces no network
 *     call, so its refusals are limited to the rest of the union.
 */
import {
  type AiFeature,
  type AiProviderId,
  type AiProviderSpec,
} from "@nimbus/types";
import {
  type CredentialView,
  type FreeTierView,
  type PreferenceView,
  type SelectedModel,
  selectModelForFeature,
} from "@nimbus/utils";
import { prisma } from "@nimbus/db";
import {
  buildAad,
  decryptSecret,
  isEncryptionConfigured,
} from "./credentialCrypto";
import { createAiClient, type AiClientHandle } from "./clientFactory";
import { freeTier as readFreeTierEnv, getProvider } from "./providers";

/**
 * The user-visible failure reasons the resolver can produce.
 *
 * `invalid-key` and `provider-error` are excluded on purpose — they are
 * produced at call time by `clientFactory.classifyClientError`. The resolver
 * sees no network, so it cannot know whether the user's key is bad or the
 * provider is down.
 */
export type AiRefusalReason =
  | "no-key"
  | "free-tier-exhausted"
  | "no-operator-key"
  | "no-capable-model"
  | "byok-unavailable";

/** A curated, non-secret-bearing refusal safe to send to the client. */
export type AiRefusal = {
  readonly ok: false;
  readonly reason: AiRefusalReason;
  readonly message: string;
  readonly cta: "add-key" | "manage-ai" | null;
  /** Optional operator-facing detail, scrubbed of any secret material. */
  readonly detail?: string;
};

/** A successful resolution, with the SDK handle and the ledger identity. */
export type AiSuccess = {
  readonly ok: true;
  readonly source: "byok" | "free";
  readonly providerId: AiProviderId;
  readonly modelId: string;
  readonly handle: AiClientHandle;
  /** The credential row this BYOK handle was built from, when applicable. */
  readonly credentialId?: string;
  /** `sha256(apiKey).slice(0,16)` — safe to log, never returned over HTTP. */
  readonly keyFingerprint?: string;
  /** True when the user's preference could not be honoured. UI explains. */
  readonly substituted: boolean;
};

/** The discriminated union the call sites consume. */
export type AiResolution = AiSuccess | AiRefusal;

/** Dependencies the resolver reads. Defaults to the live ones for production. */
export type ResolveDeps = {
  /** Prisma-shaped DB handle. Defaults to the singleton. */
  readonly prisma?: typeof prisma;
  /** Override for `isEncryptionConfigured`. Test-only. */
  readonly encryptionConfigured?: boolean;
  /** Override for the operator's free-tier view. Test-only. */
  readonly freeTier?: FreeTierView;
};

/**
 * Resolves which AI client serves `feature` for `userId`.
 *
 * The resolver does no network call. Every refusal it produces is a
 * configuration state, not a runtime failure.
 *
 * @param userId - The triggering user. A credential that is not theirs is
 *                 scoped out before selection runs, so the cache and the
 *                 substitution logic only see their own rows.
 * @param feature - Which call site is asking (chat / markdown / canvas).
 * @param deps - Optional test overrides. Production passes nothing.
 * @returns Either a {@link AiSuccess} carrying an {@link AiClientHandle}
 *          ready for `responses.create`, or an {@link AiRefusal} with a
 *          curated message and the right call-to-action.
 */
export async function resolveAi(
  userId: string,
  feature: AiFeature,
  deps: ResolveDeps = {},
): Promise<AiResolution> {
  const db = deps.prisma ?? prisma;
  const encryptionConfigured =
    deps.encryptionConfigured ?? isEncryptionConfigured();
  const freeTier = deps.freeTier ?? readFreeTierEnv();

  // Fetch the user's credentials and preferences in parallel — both are
  // indexed by userId and cheap, and the resolver needs them to feed
  // `selectModelForFeature`. A missing user row is treated as "no
  // credentials, no preferences" rather than a refusal: the call site
  // already authenticated the request, and the failure mode here is the
  // user's first request.
  const [credentials, preferences] = await Promise.all([
    db.aiCredential.findMany({
      where: { userId },
      select: { id: true, providerId: true, createdAt: true },
    }),
    db.aiFeaturePreference.findMany({
      where: { userId },
      select: { feature: true, providerId: true, modelId: true },
    }),
  ]);

  const credentialViews: CredentialView[] = credentials.map((c) => ({
    id: c.id,
    providerId: c.providerId as AiProviderId,
    createdAt: c.createdAt,
  }));
  const preferenceViews: PreferenceView[] = preferences.map((p) => ({
    // The DB enum uses uppercase; the selection helper uses lowercase. Map
    // once here so the rest of the module does not see the difference.
    feature: p.feature.toLowerCase() as AiFeature,
    providerId: p.providerId as AiProviderId,
    modelId: p.modelId,
  }));

  const selection = selectModelForFeature(
    feature,
    preferenceViews,
    credentialViews,
    freeTier,
  );

  if (!("source" in selection)) {
    return refusalFor(
      selection.reason,
      encryptionConfigured,
      freeTier !== null,
    );
  }

  return buildResolution({
    feature,
    selection,
    userId,
    encryptionConfigured,
    db,
  });
}

/**
 * Maps a `SelectionRefusal` reason to the user-visible {@link AiRefusal}.
 *
 * This is where "no BYOK surface" (`byok-unavailable`) and "no operator key"
 * (`no-operator-key`) are distinguished — the pure selector only knows
 * "no-key" and "no-capable-model", and we layer the higher-level operator
 * state on top here.
 */
function refusalFor(
  reason: "no-key" | "no-capable-model",
  encryptionConfigured: boolean,
  freeTierConfigured: boolean,
): AiRefusal {
  // The "no-key" branch covers both "no credential, no free tier" and "no
  // credential, free tier not configured (no operator key)". A user who
  // could store their own key but the server is not configured for
  // encryption is a third case — surfaced as `byok-unavailable`.
  if (reason === "no-key") {
    if (!encryptionConfigured && !freeTierConfigured) {
      return {
        ok: false,
        reason: "byok-unavailable",
        message:
          "AI features are temporarily unavailable. Please contact support.",
        cta: null,
      };
    }
    if (!encryptionConfigured) {
      // Encryption is unset but the free tier IS configured. The user can
      // still chat on the free tier; document generation only fails when
      // they have no key of their own. The CTA points at the add-key path
      // so a returning user with no key is told what is missing.
      return {
        ok: false,
        reason: "no-key",
        message: "Add your provider credentials to use this feature.",
        cta: "add-key",
      };
    }
    if (!freeTierConfigured) {
      return {
        ok: false,
        reason: "no-operator-key",
        message:
          "The free tier is not configured on this deployment. Add your provider credentials to use AI features.",
        cta: "add-key",
      };
    }
    return {
      ok: false,
      reason: "no-key",
      message: "Add your provider credentials to use this feature.",
      cta: "add-key",
    };
  }

  // reason === "no-capable-model" — every available provider's default
  // model lacks the feature's required capability. The user can fix this
  // by adding a key for a provider whose models meet the requirement, or
  // by picking a different feature model in the picker. The CTA points at
  // the manage-AI panel rather than add-key, because the row already
  // exists.
  return {
    ok: false,
    reason: "no-capable-model",
    message:
      "No available model supports this feature. Add a credential for a different provider or pick a different model.",
    cta: "manage-ai",
  };
}

type BuildResolutionDeps = {
  readonly feature: AiFeature;
  readonly selection: SelectedModel;
  readonly userId: string;
  readonly encryptionConfigured: boolean;
  readonly db: ResolveDeps["prisma"];
};

/**
 * Turns a successful selection into a full {@link AiSuccess}.
 *
 * For BYOK this decrypts the envelope and constructs the SDK client. For the
 * free tier it reads `AI_API_KEY` and constructs the client directly — the
 * operator key is not encrypted at rest, so there is no envelope to
 * decrypt.
 */
async function buildResolution(
  input: BuildResolutionDeps,
): Promise<AiResolution> {
  const { feature, selection, userId, encryptionConfigured, db } = input;

  if (selection.source === "byok") {
    if (!encryptionConfigured) {
      // Defence in depth: a BYOK selection reached this branch without an
      // encryption key, which means the operator has removed the key since
      // the credential was saved. Surface as `byok-unavailable` rather than
      // crashing — the call site will refuse rather than serve an
      // unauthorised generation.
      return {
        ok: false,
        reason: "byok-unavailable",
        message:
          "AI features are temporarily unavailable. Please contact support.",
        cta: null,
      };
    }

    const credential = await db!.aiCredential.findUnique({
      where: { id: selection.credentialId! },
      select: { keyEnvelope: true, keyFingerprint: true, providerId: true },
    });

    if (!credential) {
      // The credential row vanished between selection and lookup. Treat as
      // "no-key" — a concurrent DELETE is the expected cause, and the
      // resolver must not crash on it.
      return {
        ok: false,
        reason: "no-key",
        message: "Add an API key to use this feature.",
        cta: "add-key",
      };
    }

    const provider = getProvider(selection.providerId);
    if (!provider) {
      // A stale row pointing at a retired provider. The selector already
      // filters these out, so reaching here means a registry change
      // happened between the select call and the lookup. Surface as
      // `no-capable-model` so the user is told something concrete.
      return {
        ok: false,
        reason: "no-capable-model",
        message:
          "No available model supports this feature. Add a key for a different provider or pick a different model.",
        cta: "manage-ai",
      };
    }

    const model = provider.models.find((m) => m.id === selection.modelId);
    if (!model) {
      return {
        ok: false,
        reason: "no-capable-model",
        message:
          "No available model supports this feature. Add a key for a different provider or pick a different model.",
        cta: "manage-ai",
      };
    }

    let apiKey: string;
    try {
      apiKey = decryptSecret(
        credential.keyEnvelope,
        buildAad(userId, credential.providerId),
      );
    } catch {
      // The envelope is unreadable — wrong key (rotation?), tampered row, or
      // AAD mismatch. Surfacing as `invalid-key` would be a lie (the key
      // itself is fine), so use `byok-unavailable` and log operator-side.
      console.error(
        `[ai] Failed to decrypt credential ${credential.keyFingerprint} for user ${userId}. ` +
          "Likely cause: rotation or tampering.",
      );
      return {
        ok: false,
        reason: "byok-unavailable",
        message:
          "Your stored credential could not be decrypted. Please re-add it.",
        cta: "add-key",
      };
    }

    const handle = createAiClient({
      provider,
      apiKey,
      model,
      source: "byok",
    });

    return {
      ok: true,
      source: "byok",
      providerId: selection.providerId,
      modelId: selection.modelId,
      handle,
      credentialId: selection.credentialId ?? undefined,
      keyFingerprint: credential.keyFingerprint,
      substituted: selection.substituted,
    };
  }

  // Free tier — operator key, no encryption in the loop.
  const operatorKey = process.env.AI_API_KEY;
  if (!operatorKey || operatorKey.length === 0) {
    return {
      ok: false,
      reason: "no-operator-key",
      message:
        "The free tier is not configured on this deployment. Add an API key to use AI features.",
      cta: "add-key",
    };
  }

  const provider = getProvider(selection.providerId);
  if (!provider) {
    return {
      ok: false,
      reason: "no-capable-model",
      message:
        "No available model supports this feature. Add a key for a different provider or pick a different model.",
      cta: "manage-ai",
    };
  }

  const model = provider.models.find((m) => m.id === selection.modelId);
  if (!model) {
    return {
      ok: false,
      reason: "no-capable-model",
      message:
        "No available model supports this feature. Add a key for a different provider or pick a different model.",
      cta: "manage-ai",
    };
  }

  // Free-tier capability assumption — once per process. The plan calls for
  // exactly one `warn`, because a deployment that has not opted into the
  // curated registry will not change, and a flood of identical warnings
  // would mask the first one.
  warnFreeTierCapabilitiesOnce(feature, provider, model);

  const handle = createAiClient({
    provider,
    apiKey: operatorKey,
    model,
    source: "free",
  });

  return {
    ok: true,
    source: "free",
    providerId: selection.providerId,
    modelId: selection.modelId,
    handle,
    substituted: selection.substituted,
  };
}

/**
 * Logs a single warning per process when the free tier's model is not in
 * the curated registry. Subsequent calls in the same process are silent —
 * the gate is module-local so it survives hot-reloads during development
 * without flooding the log.
 */
let freeTierWarningLogged = false;

function warnFreeTierCapabilitiesOnce(
  feature: AiFeature,
  provider: AiProviderSpec,
  model: { id: string; capabilities: readonly string[] },
): void {
  if (freeTierWarningLogged) return;
  freeTierWarningLogged = true;
  // We do not import the registry into the warning — the caller passes the
  // resolved spec. The capability names are the same strings the picker
  // renders, so the log is human-readable without a translation step.
  console.warn(
    `[ai] Free-tier capabilities are assumed, not enforced: ` +
      `feature=${feature} provider=${provider.id} model=${model.id} ` +
      `capabilities=[${model.capabilities.join(",")}]`,
  );
}

/**
 * Test-only escape hatch: resets the once-per-process warning flag so a
 * test asserting the warning fires more than once can do so without state
 * leaking across cases.
 */
export function __resetFreeTierWarningForTests(): void {
  freeTierWarningLogged = false;
}
