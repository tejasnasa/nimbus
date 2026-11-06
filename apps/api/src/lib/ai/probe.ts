/**
 * @module api/lib/ai/probe
 * @description The save-time probe: verifies a candidate provider API key
 * with a real 1-token `responses.create` before it is stored, and probes the
 * transcription and speech models of providers that have them.
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
  AI_DEFAULT_VOICE,
  defaultModelFor,
  modelsOfKind,
  type AiEffort,
  type AiModelKind,
  type AiModelSpec,
  type AiProviderSpec,
} from "@nimbus/types";
import { reasoningKwargs, createAiClient } from "./clientFactory";
import { resolveBaseUrl } from "./providers";

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
    baseURL: resolveBaseUrl(provider),
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
export function classifyProbeError(
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

/** Per-request timeout for the audio probes. */
export const AUDIO_PROBE_TIMEOUT_MS = 15_000;

/** The sample rate of the generated probe clip. */
const PROBE_SAMPLE_RATE = 16_000;

/**
 * Builds a mono 16-bit PCM WAV of a sine tone, entirely in memory.
 *
 * The transcription probe needs real audio: a provider validates the container,
 * so an empty or garbage upload would be refused for the wrong reason.
 *
 * @param seconds - Clip length.
 * @param frequencyHz - Tone frequency.
 * @returns A complete WAV file, header included.
 */
export function buildToneWav(seconds = 1, frequencyHz = 440): Buffer {
  const samples = Math.round(PROBE_SAMPLE_RATE * seconds);
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(PROBE_SAMPLE_RATE, 24);
  buf.writeUInt32LE(PROBE_SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.sin((2 * Math.PI * frequencyHz * i) / PROBE_SAMPLE_RATE);
    buf.writeInt16LE(Math.round(sample * 0.3 * 32767), 44 + i * 2);
  }
  return buf;
}

/** Options shared by the audio probes. */
export type AudioProbeOptions = {
  /** Replaces the global `fetch`. Tests only. */
  fetchImpl?: typeof fetch;
};

/**
 * Maps an audio probe outcome to a {@link ProbeRefusal} through the same status
 * mapping the text probe uses. A thrown fetch (DNS, refused, timeout) carries
 * no status and reads as unreachable.
 */
function audioRefusal(
  provider: AiProviderSpec,
  status: number | undefined,
): ProbeRefusal {
  return classifyProbeError(
    status === undefined ? new Error("transport") : { status },
    provider,
  );
}

/**
 * Probes a transcription model with a one-second tone sent as multipart.
 *
 * Success is any 200 whose JSON body has a `text` field (the tone transcribes
 * to nothing, so the field may be empty). Nothing the provider returns is
 * passed on: only the curated refusal is.
 *
 * @param provider - Provider, for the refusal wording.
 * @param baseUrl - The URL the request goes to (see `resolveBaseUrl`).
 * @param apiKey - The candidate key. Never logged or returned.
 * @param model - The transcription model id.
 * @param options - Test seam for the request.
 */
export async function probeTranscription(
  provider: AiProviderSpec,
  baseUrl: string,
  apiKey: string,
  model: string,
  options: AudioProbeOptions = {},
): Promise<ProbeResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buildToneWav())], { type: "audio/wav" }),
    "probe.wav",
  );
  form.append("model", model);

  try {
    const res = await doFetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(AUDIO_PROBE_TIMEOUT_MS),
    });
    if (res.status !== 200) return audioRefusal(provider, res.status);
    const body = (await res.json().catch(() => null)) as {
      text?: unknown;
    } | null;
    if (!body || typeof body.text !== "string") {
      return audioRefusal(provider, 0);
    }
    return { ok: true };
  } catch {
    return audioRefusal(provider, undefined);
  }
}

/**
 * Probes a speech model by synthesising the word "ok".
 *
 * Success is a 200 with a non-empty body. The voice is omitted for a model that
 * takes none (`AI_DEFAULT_VOICE`).
 *
 * @param provider - Provider, for the refusal wording.
 * @param baseUrl - The URL the request goes to (see `resolveBaseUrl`).
 * @param apiKey - The candidate key. Never logged or returned.
 * @param model - The speech model id.
 * @param voice - The voice to request, or `default` for none.
 * @param options - Test seam for the request.
 */
export async function probeSpeech(
  provider: AiProviderSpec,
  baseUrl: string,
  apiKey: string,
  model: string,
  voice: string,
  options: AudioProbeOptions = {},
): Promise<ProbeResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const payload: Record<string, unknown> = {
    model,
    input: "ok",
    response_format: "pcm",
  };
  if (voice !== AI_DEFAULT_VOICE) payload.voice = voice;

  try {
    const res = await doFetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AUDIO_PROBE_TIMEOUT_MS),
    });
    if (res.status !== 200) return audioRefusal(provider, res.status);
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0) return audioRefusal(provider, 0);
    return { ok: true };
  } catch {
    return audioRefusal(provider, undefined);
  }
}

/** What a credential probe returns on success. */
export type CredentialProbeSuccess = {
  readonly ok: true;
  /** The kinds whose probe passed. */
  readonly verifiedKinds: AiModelKind[];
  /** Curated notes for secondary kinds that did not pass. */
  readonly warnings: string[];
};

/**
 * Probes every kind of model a provider has, in parallel.
 *
 * The primary probe decides whether the key is stored: text when the provider
 * has text models, otherwise transcription. A secondary probe that fails does
 * not block the save; it comes back as a warning and the kind is left out of
 * `verifiedKinds`, so the resolver never relies on it.
 *
 * @param provider - The provider the key is for.
 * @param apiKey - The candidate key. Never logged or returned.
 * @param options - Test seam for the audio requests.
 * @returns The verified kinds and warnings, or the primary probe's refusal.
 */
export async function probeCredential(
  provider: AiProviderSpec,
  apiKey: string,
  options: AudioProbeOptions = {},
): Promise<CredentialProbeSuccess | ProbeRefusal> {
  const baseUrl = resolveBaseUrl(provider);
  const textModel =
    defaultModelFor(provider, "text") ?? modelsOfKind(provider, "text")[0];
  const transcriptionModel = defaultModelFor(provider, "transcription");
  const speechModel = defaultModelFor(provider, "speech");

  const probes: Array<[AiModelKind, Promise<ProbeResult>]> = [];
  if (textModel) {
    probes.push([
      "text",
      probeApiKey(provider, apiKey, textModel).catch(() =>
        audioRefusal(provider, undefined),
      ),
    ]);
  }
  if (transcriptionModel) {
    probes.push([
      "transcription",
      probeTranscription(provider, baseUrl, apiKey, transcriptionModel.id, options),
    ]);
  }
  if (speechModel) {
    probes.push([
      "speech",
      probeSpeech(
        provider,
        baseUrl,
        apiKey,
        speechModel.id,
        speechModel.voices?.[0] ?? AI_DEFAULT_VOICE,
        options,
      ),
    ]);
  }

  const settled = await Promise.all(
    probes.map(async ([kind, promise]) => [kind, await promise] as const),
  );

  const primary: AiModelKind = textModel ? "text" : "transcription";
  const primaryResult = settled.find(([kind]) => kind === primary)?.[1];
  if (!primaryResult) {
    return {
      ok: false,
      reason: "unknown-error",
      message: `${provider.label} has no models Nimbus can verify a key with.`,
    };
  }
  if (!primaryResult.ok) return primaryResult;

  const verifiedKinds: AiModelKind[] = [];
  const warnings: string[] = [];
  for (const [kind, result] of settled) {
    if (result.ok) {
      verifiedKinds.push(kind);
    } else if (kind !== primary) {
      warnings.push(
        `${kind[0]!.toUpperCase()}${kind.slice(1)} models could not be verified: ${result.message}`,
      );
    }
  }
  return { ok: true, verifiedKinds, warnings };
}
