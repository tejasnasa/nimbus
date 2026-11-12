/**
 * @module agent/tts/openaiCompatibleTts
 * @description One text-to-speech request against an OpenAI-compatible
 * `/audio/speech` endpoint, returning raw 16-bit mono PCM as it arrives.
 *
 * The request asks for `response_format: "pcm"`. The sample rate is not fixed:
 * it differs by model and is stated in the response's content type
 * (`audio/pcm;rate=44100;channels=1`), so it is read from there, falling back
 * to {@link DEFAULT_PCM_RATE} when the header does not say. The body is read
 * as a stream when the response has one, otherwise as a single buffer.
 *
 * @important The key is sent only in the `Authorization` header and appears in
 *            no error: failures are {@link TtsError} kinds with fixed messages.
 *
 * @important Every request, failed or not, is reported through `onUsage` with
 *            the number of characters sent, which is what speech is billed by.
 */
import type { UsageIn } from "@nimbus/types";

/** The rate assumed when the response does not state one. */
export const DEFAULT_PCM_RATE = 24_000;

/** Longest a request may take, from sending it to the last byte, in milliseconds. */
export const TTS_TIMEOUT_MS = 10_000;

/** How a request failed. */
export type TtsErrorKind =
  | "auth"
  | "server"
  | "timeout"
  | "network"
  | "client"
  | "aborted";

/** A failed speech request. The message never includes the key. */
export class TtsError extends Error {
  readonly kind: TtsErrorKind;

  constructor(kind: TtsErrorKind, status?: number) {
    super(
      status === undefined
        ? `Speech request failed (${kind})`
        : `Speech request failed (${kind}, status ${status})`,
    );
    this.name = "TtsError";
    this.kind = kind;
  }
}

/** One sentence to synthesize. */
export type TtsRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Voice name; omitted from the request when it is the provider's default. */
  voice?: string;
  input: string;
  /** Aborts the request, including a body that is still streaming. */
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Called once per request, when it finishes or fails. */
  onUsage?: (entry: UsageIn) => void;
  /** The clock in milliseconds. Tests only. */
  now?: () => number;
};

/** A synthesized sentence: its sample rate and its samples as they arrive. */
export type TtsAudio = {
  sampleRate: number;
  chunks: AsyncIterable<Int16Array>;
};

/**
 * Reads the sample rate from a `Content-Type` such as
 * `audio/pcm;rate=44100;channels=1`.
 *
 * @param contentType - The header value, if any.
 */
export function rateFromContentType(contentType: string | null): number {
  const match = contentType?.match(/rate=(\d+)/i);
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate >= 8000 && rate <= 96_000
    ? rate
    : DEFAULT_PCM_RATE;
}

/** Turns byte chunks into whole 16-bit samples, carrying an odd byte over. */
async function* toSamples(
  bytes: AsyncIterable<Uint8Array>,
): AsyncGenerator<Int16Array> {
  let carry: Uint8Array | null = null;
  for await (const chunk of bytes) {
    let data = chunk;
    if (carry) {
      data = new Uint8Array(carry.length + chunk.length);
      data.set(carry);
      data.set(chunk, carry.length);
      carry = null;
    }
    const whole = data.length - (data.length % 2);
    if (whole < data.length) carry = data.slice(whole);
    if (whole === 0) continue;
    const copy = new Uint8Array(data.subarray(0, whole));
    yield new Int16Array(copy.buffer, 0, whole / 2);
  }
}

/** The response body as a stream of byte chunks. */
async function* bodyChunks(res: Response): AsyncGenerator<Uint8Array> {
  if (!res.body) {
    yield new Uint8Array(await res.arrayBuffer());
    return;
  }
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value && value.length > 0) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function classifyFailure(
  error: unknown,
  signal: AbortSignal | undefined,
): TtsError {
  if (error instanceof TtsError) return error;
  if (signal?.aborted) return new TtsError("aborted");
  const name = (error as { name?: string } | null)?.name;
  return new TtsError(
    name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
  );
}

/**
 * Synthesizes one sentence.
 *
 * @param request - The text and where to send it.
 * @returns The sample rate and the samples, streamed. Reading the samples can
 *          also throw a {@link TtsError} if the body breaks off.
 * @throws {TtsError} When the request is refused or never answered.
 */
export async function synthesize(request: TtsRequest): Promise<TtsAudio> {
  const { baseUrl, apiKey, model, voice, input } = request;
  const doFetch = request.fetchImpl ?? fetch;
  const now = request.now ?? Date.now;
  const startedAt = now();
  const timeout = AbortSignal.timeout(request.timeoutMs ?? TTS_TIMEOUT_MS);
  const signal = request.signal
    ? AbortSignal.any([request.signal, timeout])
    : timeout;

  let reported = false;
  const report = (status: "OK" | "ERROR", failure?: TtsError) => {
    if (reported) return;
    reported = true;
    request.onUsage?.({
      feature: "speech",
      model,
      characters: input.length,
      latencyMs: now() - startedAt,
      status,
      ...(failure && status === "ERROR"
        ? {
            errorReason:
              failure.kind === "auth"
                ? ("invalid-key" as const)
                : failure.kind === "timeout"
                  ? ("timeout" as const)
                  : ("provider-error" as const),
          }
        : {}),
    });
  };

  let res: Response;
  try {
    res = await doFetch(`${baseUrl.replace(/\/+$/, "")}/audio/speech`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input,
        response_format: "pcm",
        ...(voice && voice !== "default" ? { voice } : {}),
      }),
      signal,
    });
    if (res.status === 401 || res.status === 403)
      throw new TtsError("auth", res.status);
    if (res.status === 429 || res.status >= 500)
      throw new TtsError("server", res.status);
    if (!res.ok) throw new TtsError("client", res.status);
  } catch (error) {
    const failure = classifyFailure(error, request.signal);
    report("ERROR", failure);
    throw failure;
  }

  const sampleRate = rateFromContentType(res.headers.get("content-type"));
  async function* chunks(): AsyncGenerator<Int16Array> {
    try {
      yield* toSamples(bodyChunks(res));
    } catch (error) {
      const failure = classifyFailure(error, request.signal);
      // The provider billed for what it sent before an interruption.
      report(failure.kind === "aborted" ? "OK" : "ERROR", failure);
      throw failure;
    } finally {
      // Also reached when the reader stops early: the request still counts.
      report("OK");
    }
  }
  return { sampleRate, chunks: chunks() };
}
