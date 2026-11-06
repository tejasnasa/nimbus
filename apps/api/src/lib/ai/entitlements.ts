/**
 * @module api/lib/ai/entitlements
 * @description Resolves which AI credential/model serves a text feature in a
 * given workspace for a given user, and returns an {@link AiClientHandle} ready
 * for a call site to use, or a curated refusal.
 *
 * This module composes five things and adds no logic of its own:
 *
 *   1. `packages/utils`'s `selectModelForFeature` — the pure precedence
 *      chain (preference → credential → free tier).
 *   2. `lib/ai/providers` — the registry and the operator's free-tier env
 *      view.
 *   3. `lib/ai/credentialCrypto` — envelope decryption.
 *   4. `lib/ai/clientFactory` — the SDK client construction.
 *   5. `lib/ai/spendCap` — the workspace's monthly ceiling.
 *
 * The resolver is the only module that combines these — splitting the work
 * keeps every other piece unit-testable without spinning up an SDK mock, and
 * makes the resolver itself a thin, audited wrapper.
 *
 * @important Credentials and preferences belong to the **workspace**: whoever
 *            triggers a request spends the workspace's key. The `userId` is
 *            carried for the call log and for the free tier, whose allowance is
 *            charged to the person asking, never to the workspace.
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
 *
 * @important Audio features (transcription, speech) are not resolved here. They
 *            go through `voiceEntitlements`, which returns a plaintext key and
 *            is deliberately a separate, lint-restricted entry point.
 */
import {
  type AiCapability,
  type AiFeature,
  type AiModelKind,
  type AiModelSource,
  type AiModelSpec,
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
import { buildAad, decryptSecret } from "./credentialCrypto";
import { createAiClient, type AiClientHandle } from "./clientFactory";
import type { AiCallMeta } from "./callLog";
import { freeTier as readFreeTierEnv, getProvider } from "./providers";
import { isOverCap } from "./spendCap";

/** The features this resolver serves: the ones a text model answers. */
export type ResolvableFeature = Extract<
  AiFeature,
  "chat" | "markdown" | "canvas" | "vision" | "meeting"
>;

/**
 * The user-visible failure reasons the resolver can produce.
 *
 * `invalid-key` and `provider-error` are excluded on purpose — they are
 * produced at call time by `clientFactory.classifyClientError`. The resolver
 * sees no network, so it cannot know whether the key is bad or the provider is
 * down.
 */
export type AiRefusalReason =
  | "no-key"
  | "free-tier-exhausted"
  | "no-operator-key"
  | "no-capable-model"
  | "spend-cap-reached";

/** A curated, non-secret-bearing refusal safe to send to the client. */
export type AiRefusal = {
  readonly ok: false;
  readonly reason: AiRefusalReason;
  readonly message: string;
  readonly cta: "add-key" | "manage-ai" | null;
  /** Optional operator-facing detail, scrubbed of any secret material. */
  readonly detail?: string;
  /** The selection that would have run, for the call log. */
  readonly attempted?: {
    readonly providerId: AiProviderId;
    readonly modelId: string;
    readonly source: "byok" | "free";
  };
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
  /** True when the workspace's preference could not be honoured. UI explains. */
  readonly substituted: boolean;
  /** What the call log needs to describe a call made through this handle. */
  readonly meta: AiCallMeta;
};

/** The discriminated union the call sites consume. */
export type AiResolution = AiSuccess | AiRefusal;

/** Who is asking, and for what. */
export type ResolveAiInput = {
  /** The workspace whose key and preferences apply. */
  readonly workspaceId: string;
  /** The triggering user: charged for the free tier, named in the call log. */
  readonly userId: string;
  readonly feature: ResolvableFeature;
};

/** Dependencies the resolver reads. Defaults to the live ones for production. */
export type ResolveDeps = {
  /** Prisma-shaped DB handle. Defaults to the singleton. */
  readonly prisma?: typeof prisma;
  /** Override for the operator's free-tier view. Test-only. */
  readonly freeTier?: FreeTierView;
  /** Override for the spend cap check. Test-only. */
  readonly isOverCap?: (workspaceId: string) => Promise<boolean>;
};

/** The workspace's stored credentials and preferences, as selection sees them. */
export type WorkspaceAiViews = {
  readonly credentialViews: CredentialView[];
  readonly preferenceViews: PreferenceView[];
};

/**
 * Loads a workspace's credentials and preferences and maps them to the views
 * `selectModelForFeature` takes. Shared by the resolver and the status route so
 * the two can never disagree about what is selectable.
 *
 * @param workspaceId - The workspace.
 * @param db - Prisma handle; defaults to the singleton.
 */
export async function loadWorkspaceAiViews(
  workspaceId: string,
  db: Pick<typeof prisma, "workspaceAiCredential" | "workspaceAiPreference"> = prisma,
): Promise<WorkspaceAiViews> {
  const [credentials, preferences] = await Promise.all([
    db.workspaceAiCredential.findMany({
      where: { workspaceId },
      select: {
        id: true,
        providerId: true,
        createdAt: true,
        verifiedKinds: true,
      },
    }),
    db.workspaceAiPreference.findMany({
      where: { workspaceId },
      select: {
        feature: true,
        providerId: true,
        modelId: true,
        modelSource: true,
        modelCapabilities: true,
      },
    }),
  ]);

  return {
    credentialViews: credentials.map((c) => ({
      id: c.id,
      providerId: c.providerId as AiProviderId,
      createdAt: c.createdAt,
      verifiedKinds: c.verifiedKinds as AiModelKind[],
    })),
    preferenceViews: preferences.map((p) => ({
      // The DB enum uses uppercase; the selection helper uses lowercase. Map
      // once here so the rest of the module does not see the difference.
      feature: p.feature.toLowerCase() as AiFeature,
      providerId: p.providerId as AiProviderId,
      modelId: p.modelId,
      source: p.modelSource as AiModelSource,
      capabilities: p.modelCapabilities as AiCapability[],
    })),
  };
}

/**
 * Resolves which AI client serves `feature` in a workspace.
 *
 * The resolver does no provider call. Every refusal it produces is a
 * configuration state, not a runtime failure.
 *
 * @param input - The workspace, the triggering user and the feature.
 * @param deps - Optional test overrides. Production passes nothing.
 * @returns Either a {@link AiSuccess} carrying an {@link AiClientHandle}
 *          ready for `responses.create`, or an {@link AiRefusal} with a
 *          curated message and the right call-to-action.
 */
export async function resolveAi(
  input: ResolveAiInput,
  deps: ResolveDeps = {},
): Promise<AiResolution> {
  const { workspaceId, userId, feature } = input;
  const db = deps.prisma ?? prisma;
  const freeTier = deps.freeTier ?? readFreeTierEnv();

  const { credentialViews, preferenceViews } = await loadWorkspaceAiViews(
    workspaceId,
    db,
  );

  const selection = selectModelForFeature(
    feature,
    preferenceViews,
    credentialViews,
    freeTier,
  );

  if (!("source" in selection)) {
    return refusalFor(selection.reason, freeTier !== null);
  }

  // The cap guards the workspace's own keys. A free-tier call spends the
  // operator's money, bounded by the caller's quota, not the workspace's.
  if (selection.source === "byok") {
    const overCap = await (deps.isOverCap ?? isOverCap)(workspaceId);
    if (overCap) {
      return {
        ok: false,
        reason: "spend-cap-reached",
        message:
          "This workspace has reached its monthly AI spend cap. An admin can raise it in AI settings.",
        cta: "manage-ai",
        attempted: {
          providerId: selection.providerId,
          modelId: selection.modelId,
          source: "byok",
        },
      };
    }
  }

  return buildResolution({
    feature,
    selection,
    workspaceId,
    userId,
    db,
    preference: preferenceViews.find((p) => p.feature === feature),
  });
}

/**
 * Maps a `SelectionRefusal` reason to the user-visible {@link AiRefusal}.
 *
 * This is where "no operator key" (`no-operator-key`) is distinguished from a
 * plain missing credential — the pure selector only knows "no-key" and
 * "no-capable-model", and the higher-level operator state is layered on here.
 */
function refusalFor(
  reason: "no-key" | "no-capable-model",
  freeTierConfigured: boolean,
): AiRefusal {
  // The "no-key" branch covers both "no credential, no free tier" and "no
  // credential, free tier not configured (no operator key)".
  if (reason === "no-key") {
    if (!freeTierConfigured) {
      return {
        ok: false,
        reason: "no-operator-key",
        message:
          "The free tier is not configured on this deployment. A workspace admin can add a provider key in AI settings.",
        cta: "add-key",
      };
    }
    return {
      ok: false,
      reason: "no-key",
      message: "A workspace admin needs to add a provider key to use this feature.",
      cta: "add-key",
    };
  }

  // reason === "no-capable-model" — every available provider's default
  // model lacks the feature's required capability. The fix is a key for a
  // provider whose models meet the requirement, or a different model in the
  // picker. The CTA points at the manage-AI panel rather than add-key,
  // because the row already exists.
  return {
    ok: false,
    reason: "no-capable-model",
    message:
      "No available model supports this feature. Add a key for a different provider or pick a different model.",
    cta: "manage-ai",
  };
}

type BuildResolutionDeps = {
  readonly feature: ResolvableFeature;
  readonly selection: SelectedModel;
  readonly workspaceId: string;
  readonly userId: string;
  readonly db: ResolveDeps["prisma"];
  /** The workspace's saved preference for the feature, when there is one. */
  readonly preference?: PreferenceView;
};

/**
 * The model spec for a selection that came from a catalogue or custom
 * preference, built from the capabilities stored with it. `undefined` when the
 * selection is not that preference (a substituted default, the free tier) or
 * the preference is a registry one.
 */
function storedModelSpec(
  preference: PreferenceView | undefined,
  selection: SelectedModel,
): AiModelSpec | undefined {
  if (
    !preference ||
    preference.source === undefined ||
    preference.source === "registry" ||
    preference.providerId !== selection.providerId ||
    preference.modelId !== selection.modelId
  ) {
    return undefined;
  }
  const capabilities = preference.capabilities ?? [];
  return {
    id: preference.modelId,
    label: preference.modelId,
    capabilities,
    effortLevels: capabilities.includes("reasoning") ? ["low", "high"] : [],
  };
}

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
  const { feature, selection, workspaceId, userId, db, preference } = input;

  if (selection.source === "byok") {
    const credential = await db!.workspaceAiCredential.findUnique({
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
        message: "A workspace admin needs to add a provider key to use this feature.",
        cta: "add-key",
      };
    }

    const provider = getProvider(selection.providerId);
    if (!provider) {
      // A stale row pointing at a retired provider. The selector already
      // filters these out, so reaching here means a registry change
      // happened between the select call and the lookup. Surface as
      // `no-capable-model` so the user is told something concrete.
      return noCapableModel();
    }

    const model =
      provider.models.find((m) => m.id === selection.modelId) ??
      storedModelSpec(preference, selection);
    if (!model) return noCapableModel();

    let apiKey: string;
    try {
      apiKey = decryptSecret(
        credential.keyEnvelope,
        buildAad({ kind: "workspace", workspaceId }, credential.providerId),
      );
    } catch {
      // The envelope is unreadable — wrong key (rotation?), tampered row, or
      // AAD mismatch. Surfacing as `invalid-key` would be a lie (the key
      // itself is fine), so ask for it to be added again and log operator-side.
      console.error(
        `[ai] Failed to decrypt credential ${credential.keyFingerprint} for workspace ${workspaceId}. ` +
          "Likely cause: rotation or tampering.",
      );
      return {
        ok: false,
        reason: "no-key",
        message:
          "The workspace's stored credential could not be read. An admin needs to add it again.",
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
      meta: {
        workspaceId,
        userId,
        feature,
        providerId: selection.providerId,
        modelId: selection.modelId,
        source: "byok",
        pricing: model.pricing,
        credentialId: selection.credentialId ?? undefined,
      },
    };
  }

  // Free tier — operator key, no encryption in the loop.
  const operatorKey = process.env.AI_API_KEY;
  if (!operatorKey || operatorKey.length === 0) {
    return {
      ok: false,
      reason: "no-operator-key",
      message:
        "The free tier is not configured on this deployment. A workspace admin can add a provider key in AI settings.",
      cta: "add-key",
    };
  }

  const provider = getProvider(selection.providerId);
  if (!provider) return noCapableModel();

  const model = provider.models.find((m) => m.id === selection.modelId);
  if (!model) return noCapableModel();

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
    meta: {
      workspaceId,
      userId,
      feature,
      providerId: selection.providerId,
      modelId: selection.modelId,
      source: "free",
      pricing: model.pricing,
    },
  };
}

/** The refusal for a registry that no longer matches the stored selection. */
function noCapableModel(): AiRefusal {
  return {
    ok: false,
    reason: "no-capable-model",
    message:
      "No available model supports this feature. Add a key for a different provider or pick a different model.",
    cta: "manage-ai",
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
