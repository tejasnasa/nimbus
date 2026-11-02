/**
 * @module api/scripts/verifyProvider
 * @description Measures one provider (and optionally one model id) with a real
 * key, so the registry's `verifiedAt` and a model's capabilities can be stamped
 * from evidence rather than from documentation.
 *
 * Runs the same two checks the app runs: the save-time key probe
 * ({@link probeApiKey}) against the provider's registry model, then the
 * capability probe ({@link probeModel}) against `MODEL_ID` when given, or the
 * provider's default model otherwise.
 *
 * Usage, from `apps/api`:
 *
 *     PROVIDER_ID=openrouter PROVIDER_API_KEY=sk-or-... \
 *       MODEL_ID=openai/gpt-4o-mini npx tsx src/scripts/verifyProvider.ts
 *
 * @important Reads the key from the environment only and never prints it, in any
 *            form. Output is the provider, the model id, and the measured
 *            results. It makes real, billable (tiny) requests, and it writes
 *            nothing: stamping `verifiedAt` stays a deliberate edit to the
 *            registry.
 */
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  meetsRequirements,
  modelById,
  type AiProviderId,
} from "@nimbus/types";
import { probeModel } from "../lib/ai/modelProbe";
import { probeApiKey } from "../lib/ai/probe";

/** The probes and output sinks {@link verifyProvider} uses; swappable in tests. */
export type VerifyProviderDeps = {
  readonly probeApiKey: typeof probeApiKey;
  readonly probeModel: typeof probeModel;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
};

const defaultDeps: VerifyProviderDeps = {
  probeApiKey,
  probeModel,
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

/**
 * Runs the key probe and the capability probe for one provider and prints the
 * comparison with the registry.
 *
 * @param env - Reads `PROVIDER_ID`, `PROVIDER_API_KEY` and optional `MODEL_ID`.
 * @param deps - Probes and output sinks; defaults to the real ones.
 * @returns The process exit code: 0 when both probes pass, 1 when a probe
 *          fails, 2 for bad input.
 */
export async function verifyProvider(
  env: NodeJS.ProcessEnv = process.env,
  deps: VerifyProviderDeps = defaultDeps,
): Promise<number> {
  const { log, error } = deps;
  const providerId = env.PROVIDER_ID as AiProviderId | undefined;
  const apiKey = env.PROVIDER_API_KEY;

  if (!providerId || !AI_PROVIDER_IDS.includes(providerId)) {
    error(`PROVIDER_ID must be one of: ${AI_PROVIDER_IDS.join(", ")}.`);
    return 2;
  }
  if (!apiKey) {
    error("PROVIDER_API_KEY is required.");
    return 2;
  }

  const provider = AI_PROVIDERS[providerId];
  const modelId = env.MODEL_ID || provider.defaultModel;
  log(`Provider: ${provider.label} (${provider.baseUrl})`);
  log(`Model:    ${modelId}`);

  // 1. The save-time key probe, using a registry model that serves chat.
  const registryModel =
    modelById(provider, modelId) ??
    provider.models.find((m) => meetsRequirements(m, "chat")) ??
    provider.models[0];
  if (!registryModel) {
    error("The provider has no registry model to probe with.");
    return 2;
  }
  const keyProbe = await deps.probeApiKey(provider, apiKey, registryModel);
  log(
    `\nKey probe (${registryModel.id}): ${
      keyProbe.ok ? "OK" : `FAILED, ${keyProbe.reason}: ${keyProbe.message}`
    }`,
  );

  // 2. The capability probe for the requested id.
  const measured = await deps.probeModel(provider, apiKey, modelId);
  if (!measured.ok) {
    log(`Capability probe: FAILED, ${measured.reason}: ${measured.message}`);
    return 1;
  }

  const registered = modelById(provider, modelId);
  log(`Capability probe: OK`);
  log(`  measured:  ${measured.capabilities.join(", ") || "(none)"}`);
  log(`  serves:    ${measured.servesFeatures.join(", ") || "(no feature)"}`);

  if (registered) {
    const claimed = [...registered.capabilities].sort();
    const found = [...measured.capabilities].sort();
    const missing = claimed.filter((c) => !found.includes(c));
    const extra = found.filter((c) => !claimed.includes(c));
    log(`  registry:  ${claimed.join(", ")}`);
    log(
      missing.length === 0 && extra.length === 0
        ? "  registry matches the measurement."
        : `  registry differs. claimed but not measured: ${missing.join(", ") || "none"}; measured but not claimed: ${extra.join(", ") || "none"}.`,
    );
  } else {
    log("  (this id is not in the registry; nothing to compare)");
  }

  return keyProbe.ok ? 0 : 1;
}

if (require.main === module) {
  verifyProvider().then(
    (code) => process.exit(code),
    () => {
      // Deliberately not printing the error: some providers echo request
      // parameters, including the key, in their error text.
      console.error("The verification failed unexpectedly.");
      process.exit(1);
    },
  );
}
