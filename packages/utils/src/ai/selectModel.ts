/**
 * @module utils/ai/selectModel
 * @description Pure precedence logic that decides which (provider, model) pair
 * serves a feature for a user. Consumed by the resolver in Phase 3, where the
 * AiClientHandle is constructed and the network call is made.
 *
 * The split between this module and `apps/api/src/lib/ai/entitlements.ts` is
 * deliberate: this file is *pure* (no DB, no env, no SDK, no logger) so it can
 * be exhaustively unit-tested with table-driven cases and re-used by the eval
 * harness later. The resolver wraps it with the side-effecting pieces
 * (decrypt the credential, construct the client, check the quota, log the
 * substitution).
 *
 * @important This module must NOT import anything from `@nimbus/types`'s
 *            socket or api barrels, and must NOT import `apps/api/*`. The
 *            registry types are the only types it may consume from
 *            `@nimbus/types`, because the picker in the web bundle imports the
 *            registry and Phase 3's resolver will import this file from the
 *            API. Keeping the dependency one-way is what lets both sides
 *            agree without circular imports.
 */

import {
  AI_PROVIDERS,
  meetsRequirements,
  modelById,
  type AiFeature,
  type AiModelSpec,
  type AiProviderId,
  type AiProviderSpec,
} from "@nimbus/types";

/**
 * A stored credential, stripped of everything except what selection needs.
 * Phase 2 owns the real shape (`AiCredential` in Prisma); the resolver maps
 * rows to this view before calling `selectModelForFeature`.
 */
export type CredentialView = {
  readonly id: string;
  readonly providerId: AiProviderId;
  readonly createdAt: Date;
};

/**
 * A stored per-feature preference. Phase 2 owns the real shape; the resolver
 * maps `AiFeaturePreference` rows to this view.
 */
export type PreferenceView = {
  readonly feature: AiFeature;
  readonly providerId: AiProviderId;
  readonly modelId: string;
};

/** The free tier the operator has configured, or null when disabled. */
export type FreeTierView = {
  readonly providerId: AiProviderId;
  readonly modelId: string;
} | null;

/**
 * A successful selection: which provider and model serve the feature, and the
 * provenance so the caller (and the UI) can explain a substitution.
 *
 * `substituted` is true when the user's stated preference or primary
 * credential did not name a model that meets the feature's hard
 * requirements, and selection fell through to a different credential. Phase 3
 * surfaces this on `AiStatusDTO` so the picker can say "your saved model
 * can't do canvas, so we're using X".
 */
export type SelectedModel = {
  readonly ok: true;
  readonly source: "byok" | "free";
  readonly providerId: AiProviderId;
  readonly modelId: string;
  readonly credentialId: string | null;
  readonly substituted: boolean;
};

/**
 * A refusal from the selection step alone. The full `AiResolution` union in
 * Phase 3 adds reasons produced later (`byok-unavailable`, `invalid-key`,
 * `provider-error`, …); Phase 1 only needs the two reasons that can be
 * decided without a DB read or a network call.
 */
export type SelectionRefusal = {
  readonly ok: false;
  readonly reason: "no-key" | "no-capable-model";
};

/**
 * Picks the (provider, model) that serves `feature` for a user.
 *
 * Precedence (mirrors `byok_plan.md` §5):
 *   1. The feature's preference → credential for that provider → that model,
 *      **provided** it meets the feature's hard requirements. If the registry
 *      changed and the chosen model no longer meets them, fall to step 3
 *      *within that provider*.
 *   2. Preference present but the credential is gone (key deleted) → fall
 *      through to step 3, do not refuse.
 *   3. The user's primary credential (earliest `createdAt`, then `id`), using
 *      the provider's `defaultModel`. If that provider has no capable model,
 *      try the next credential in order.
 *   4. The free tier, **only when the user has no credentials at all**. A user
 *      with a credential never consumes the free tier (decision 9).
 *   5. Refusal.
 *
 * The function is pure: no DB, no env, no logger. The single `console.warn`
 * the plan calls for — "free-tier capabilities are assumed, not enforced" —
 * lives in the resolver wrapper, not here, because logging is a side effect.
 *
 * @param feature - Which call site is asking (chat / markdown / canvas).
 * @param preferences - The user's per-feature saved preferences, or empty.
 * @param credentials - The user's stored credentials, in any order.
 * @param freeTier - The operator's configured free tier, or null when disabled.
 * @param providers - The provider registry, defaulting to the imported one.
 *                   Accepting it as a parameter keeps the function easy to
 *                   test with a synthetic registry, and matches the
 *                   `byok_plan.md` §1 rule that the registry is the
 *                   single source of truth for base URLs and capabilities.
 * @returns A `SelectedModel` on success or a `SelectionRefusal` on failure.
 */
export function selectModelForFeature(
  feature: AiFeature,
  preferences: readonly PreferenceView[],
  credentials: readonly CredentialView[],
  freeTier: FreeTierView,
  providers: Record<AiProviderId, AiProviderSpec> = AI_PROVIDERS,
): SelectedModel | SelectionRefusal {
  const pref = preferences.find((p) => p.feature === feature) ?? null;

  // A credential for a provider that is no longer in the registry cannot be
  // used to construct a client. Decision 9 says "a user with a key never
  // consumes the free tier", but a stale row pointing at a retired provider
  // is not a key — so we count only credentials with a known provider when
  // deciding whether the free tier applies.
  const usableCredentials = credentials.filter(
    (c) => providers[c.providerId] !== undefined,
  );

  // 1. Preference → credential for that provider → that model.
  //    Unknown provider id is treated as "no preference" rather than a hard
  //    error, so a stale row from before a registry change degrades gracefully
  //    instead of refusing the whole feature.
  if (pref && providers[pref.providerId]) {
    const credential = credentials.find(
      (c) => c.providerId === pref.providerId,
    );
    if (credential) {
      const model = modelById(providers[pref.providerId], pref.modelId);
      if (model && meetsRequirements(model, feature)) {
        return {
          ok: true,
          source: "byok",
          providerId: pref.providerId,
          modelId: model.id,
          credentialId: credential.id,
          substituted: false,
        };
      }
    }
    // 2. Preference present but credential gone, or model not capable →
    //    fall through to step 3. Don't refuse.
  }

  // 3. Primary credential (earliest createdAt, then id) → provider default.
  //    `usableCredentials` is filtered above, so `provider` is guaranteed to
  //    be present here — no defensive check needed.
  const ordered = [...usableCredentials].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );

  for (const credential of ordered) {
    const provider = providers[credential.providerId]!;
    const candidate = modelById(provider, provider.defaultModel);
    if (candidate && meetsRequirements(candidate, feature)) {
      // `substituted` is true when a preference was set but did not yield a
      // usable model — the user picked something, and we are using the
      // provider's default instead. It is not about which credential; it is
      // about whether the user's stated choice was honoured.
      const substituted =
        pref !== null && pref.providerId === credential.providerId;
      return {
        ok: true,
        source: "byok",
        providerId: credential.providerId,
        modelId: candidate.id,
        credentialId: credential.id,
        substituted,
      };
    }
  }

  // 4. Free tier — only when the user has no usable credentials at all.
  if (usableCredentials.length === 0 && freeTier) {
    const provider = providers[freeTier.providerId];
    if (provider) {
      const model = modelById(provider, freeTier.modelId);
      if (model && meetsRequirements(model, feature)) {
        return {
          ok: true,
          source: "free",
          providerId: freeTier.providerId,
          modelId: model.id,
          credentialId: null,
          substituted: false,
        };
      }
    }
  }

  // 5. Refusal.
  if (usableCredentials.length === 0 && !freeTier) {
    return { ok: false, reason: "no-key" };
  }
  // At this point we either have credentials but none have a capable model,
  // or the free tier was configured but its model does not meet the feature's
  // requirements.
  return { ok: false, reason: "no-capable-model" };
}

/**
 * Whether a model is offered for a feature — i.e. is registered AND meets the
 * feature's hard requirements. Convenience wrapper around `meetsRequirements`
 * for callers that already have the provider in hand. Phase 8's picker uses
 * this on every option to decide whether to disable it.
 *
 * @param provider - The provider whose model is being checked.
 * @param modelId - The model id to look up. Unknown ids return false.
 * @param feature - Which call site the picker is building.
 * @returns True when the model exists and meets the hard requirements.
 */
export function isOfferedFor(
  provider: AiProviderSpec,
  modelId: string,
  feature: AiFeature,
): boolean {
  const model = modelById(provider, modelId);
  if (!model) return false;
  return meetsRequirements(model, feature);
}

/** Re-exported here so the picker can import a single path. */
export type { AiFeature, AiModelSpec };
