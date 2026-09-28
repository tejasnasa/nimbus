/**
 * @module api/lib/ai/probe
 * @description The save-time probe: verifies a candidate provider API key
 * with a real 1-token `responses.create` before it is stored.
 *
 * Adopted from Illume, where it proved out the value of catching the wrong
 * key at the form rather than as a silently empty artifact later. The
 * shape this probe sends is the **same** shape {@link reasoningKwargs}
 * produces for a real call — a probe that sends a simpler request verifies
 * the wrong thing.
 *
 * Constraints (per the plan, §6):
 *   - `timeout: 15` — short enough that a hung provider does not stall the
 *     form for a human, long enough that a slow first request still completes;
 *   - `maxRetries: 0` — a probe that retries is hiding a real failure;
 *   - a 16-token `responses.create` — the cheapest meaningful call;
 *   - map SDK errors to **user-visible, curated** messages:
 *       - `AuthenticationError` / `PermissionDeniedError` (401 / 403) →
 *         "Incorrect API key";
 *       - `NotFoundError` (404) → "That model isn't available on {label}";
 *       - `APIConnectionError` / `APIConnectionTimeoutError` →
 *         "Could not reach {label}".
 *
 * @important Store only on success. A half-saved credential is worse than
 *            none, because the UI will show a row the resolver refuses to
 *            use. The controller's job is to gate the upsert on
 *            {@link probeApiKey} returning `ok: true`.
 */
import OpenAI from "openai";
import {
  type AiEffort,
  type AiModelSpec,
  type AiProviderSpec,
} from "@nimbus/types";
import { reasoningKwargs, createAiClient } from "./clientFactory";

/** The user-visible failure reasons a probe can produce. */
export type ProbeRefusalReason =
  | "incorrect-key"
  | "model-not-found"
  | "unreachable"
  | "unknown-error";

/** A successful probe — the key works. */
export type ProbeSuccess = {
  readonly ok: true;
};

/** A failed probe — the controller MUST refuse to store the credential. */
export type ProbeRefusal = {
  readonly ok: false;
  readonly reason: ProbeRefusalReason;
  /** Curated user-visible message. Never echoes the key. */
  readonly message: string;
};

/** The discriminator the controller consumes. */
export type ProbeResult = ProbeSuccess | ProbeRefusal;

/**
 * Sends a minimal `responses.create` against the candidate key/model pair.
 *
 * @param provider - The provider whose base URL the SDK is constructed with.
 * @param apiKey - The plaintext key the user just pasted.
 * @param model - The model the credential will be associated with.
 * @param effort - The reasoning effort to use in the probe. Must match a
 *                  level the model advertises; passed through to
 *                  {@link reasoningKwargs} so the probe exercises the same
 *                  request shape a real call would.
 * @returns A {@link ProbeResult}. The controller refuses the upsert on
 *          anything other than `ok: true`.
 */
export async function probeApiKey(
  provider: AiProviderSpec,
  apiKey: string,
  model: AiModelSpec,
  effort: AiEffort = "low",
): Promise<ProbeResult> {
  // Construct the client directly rather than going through the cached
  // `createAiClient` factory: a probe is per-user, per-save, and we want it
  // to fail loudly if the SDK constructor rejects the inputs.
  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseUrl,
    timeout: 15_000,
    maxRetries: 0,
  });

  // Build a temporary handle so `reasoningKwargs` can resolve the model's
  // `reasoningSummary` capability from the registry without duplicating the
  // logic. The handle is thrown away after the probe; it is not stored or
  // returned.
  const tempHandle = createAiClient({
    provider,
    apiKey,
    model,
    source: "byok",
  });

  try {
    await client.responses.create({
      model: model.id,
      input: "hi",
      ...reasoningKwargs(tempHandle, effort),
      max_output_tokens: 16,
    });
    return { ok: true };
  } catch (err) {
    return classifyProbeError(err, provider);
  }
}

/**
 * Maps an SDK error thrown by the probe to a curated user-visible reason.
 *
 * Status-based mapping (not class-based) — same convention as
 * {@link classifyClientError}. A missing `status` falls through to
 * `unreachable` because transport failures (DNS, connection refused, timeout)
 * are exactly the case the SDK reports without a status.
 */
function classifyProbeError(
  err: unknown,
  provider: AiProviderSpec,
): ProbeRefusal {
  const status = errorStatus(err);

  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: "incorrect-key",
      message: "Incorrect API key.",
    };
  }

  if (status === 404) {
    return {
      ok: false,
      reason: "model-not-found",
      message: `That model isn't available on ${provider.label}.`,
    };
  }

  // APIConnectionError / APIConnectionTimeoutError surface without a status.
  // The SDK names them, but reading `status` keeps us decoupled from a
  // particular taxonomy — a future SDK bump that renames the classes still
  // reports `undefined` here for transport failures.
  if (status === undefined) {
    return {
      ok: false,
      reason: "unreachable",
      message: `Could not reach ${provider.label}.`,
    };
  }

  // 4xx other than 401/403/404 (rate limit, payload shape, …) and 5xx land
  // here. A real provider outage reads as `unreachable` from the user's
  // point of view, so we report it that way rather than leaking the SDK
  // class name.
  return {
    ok: false,
    reason: "unknown-error",
    message: `${provider.label} could not validate the request. Please try again.`,
  };
}

/**
 * Extracts an HTTP status from an unknown thrown value.
 *
 * Mirrors {@link errorStatus} in the client factory so the probe and the
 * call-time classifier read SDK errors the same way.
 */
function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") return status;
  return undefined;
}
