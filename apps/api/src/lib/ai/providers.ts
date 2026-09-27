/**
 * @module api/lib/ai/providers
 * @description Resolver-side view of the provider registry plus the operator's
 * free-tier configuration.
 *
 * `packages/types/src/ai/providers.ts` holds the *data* — providers, models,
 * capabilities, base URLs — and ships in the web bundle so the picker can
 * share it without a round-trip. This module adds two things the *resolver*
 * needs that the data module does not own:
 *
 *   1. The operator's free-tier config (which provider + model + key) read
 *      from env at call time, so a deployment can be reconfigured without
 *      touching the registry.
 *   2. The narrow "what does entitlements need to ask?" surface — re-exported
 *      registry types, plus the `getProvider`, `getModel`, `getProviderForId`
 *      helpers that wrap the typed registry in a `Result`-free lookup.
 *
 * @important This module must NOT add behaviour the data module is missing.
 *            Predicates and selection live in `packages/utils` and `@nimbus/types`
 *            respectively — the resolver composes them rather than reaching around
 *            them. The reason is the same as the registry's: the picker in the
 *            web bundle imports the same data, so any logic here is a parallel
 *            implementation that will drift.
 */
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  meetsRequirements,
  modelById,
  type AiFeature,
  type AiModelSpec,
  type AiProviderId,
  type AiProviderSpec,
} from "@nimbus/types";

/**
 * The operator's free-tier configuration: which provider, which model, and
 * whether a key is configured. A `null` `freeTier()` return means the free
 * tier is unconfigured (`AI_API_KEY` is empty) and any request that would
 * have used it must refuse.
 */
export type FreeTierConfig = {
  readonly providerId: AiProviderId;
  readonly modelId: string;
} | null;

/**
 * Reads the operator's free-tier config from env.
 *
 * The free tier is **unconfigured** when `AI_API_KEY` is empty (not set, or
 * set to the empty string). An unconfigured free tier is not the same as
 * "no provider" — the registry defaults `AI_PROVIDER` / `AI_MODEL` to
 * `deepseek` / `deepseek-flash` — it is a deliberate "the operator did not
 * pay for a free tier" choice, and the resolver turns it into a
 * `no-operator-key` refusal rather than crashing.
 *
 * @returns A `FreeTierConfig` when a key is set, `null` otherwise.
 */
export function freeTier(): FreeTierConfig {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    return null;
  }

  const providerId = parseProviderId(process.env.AI_PROVIDER) ?? "deepseek";
  const modelId = process.env.AI_MODEL?.length
    ? process.env.AI_MODEL
    : "deepseek-flash";

  return { providerId, modelId };
}

/**
 * Parses `AI_PROVIDER` from env into a registry id, ignoring unknown values.
 *
 * The env var is a string with a zod default of `"deepseek"`, so an
 * unrecognised value here is a misconfiguration rather than a normal case.
 * Returning `undefined` lets the caller fall through to its documented
 * default rather than throwing — the resolver would refuse later, with a
 * clearer reason than "the env var is broken".
 */
function parseProviderId(raw: string | undefined): AiProviderId | undefined {
  if (!raw) return undefined;
  return (AI_PROVIDER_IDS as readonly string[]).includes(raw)
    ? (raw as AiProviderId)
    : undefined;
}

/**
 * Whether the encryption key is configured.
 *
 * Re-exported so the resolver has one place to look for both "can we store
 * credentials" and "can we decrypt them on read". The credential routes also
 * call this directly.
 */
export { isEncryptionConfigured } from "./credentialCrypto";

/** A typed lookup of a provider by id. Returns `undefined` for unknown ids. */
export function getProvider(id: AiProviderId): AiProviderSpec | undefined {
  return AI_PROVIDERS[id];
}

/** A typed lookup of a model on a provider. Returns `undefined` for unknown ids. */
export function getModel(
  provider: AiProviderSpec,
  modelId: string,
): AiModelSpec | undefined {
  return modelById(provider, modelId);
}

/**
 * Whether a model satisfies the feature's hard requirements.
 *
 * Re-exported so the resolver does not have to know the registry lives in
 * `@nimbus/types` — it imports the predicates from one place.
 */
export function modelMeetsRequirements(
  model: AiModelSpec,
  feature: AiFeature,
): boolean {
  return meetsRequirements(model, feature);
}
