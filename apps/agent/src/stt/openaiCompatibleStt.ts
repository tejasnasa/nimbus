/**
 * @module agent/stt/openaiCompatibleStt
 * @description One speech-to-text request against an OpenAI-compatible
 * `/audio/transcriptions` endpoint (OpenAI, OpenRouter, Groq and the like), sent
 * as multipart form data.
 *
 * @important The key is sent only in the `Authorization` header and appears in
 *            no error: failures are classified into {@link SttError} kinds with
 *            fixed messages, because a provider's error body can echo request
 *            details, and a thrown message ends up in logs.
 *
 * @important The result's `seconds` is optional. Duration-billed models report
 *            it; token-billed ones do not, and the caller then falls back to the
 *            clip's own length.
 */

/** How a request failed, which decides whether it is worth repeating. */
export type SttErrorKind =
  /** 401 or 403: the key is wrong or lacks audio access. Repeating cannot help. */
  | "auth"
  /** A 5xx or 429: the provider had a problem. Worth one more try. */
  | "server"
  /** No answer in time. Worth one more try. */
  | "timeout"
  /** The connection failed before any answer. Worth one more try. */
  | "network"
  /** Any other 4xx: the request itself was refused. */
  | "client";

/** A failed transcription request. The message never includes the key. */
export class SttError extends Error {
  readonly kind: SttErrorKind;
  readonly status?: number;

  constructor(kind: SttErrorKind, status?: number) {
    super(
      status === undefined
        ? `Transcription request failed (${kind})`
        : `Transcription request failed (${kind}, status ${status})`,
    );
    this.name = "SttError";
    this.kind = kind;
    this.status = status;
  }

  /** Whether a second attempt could plausibly succeed. */
  get retryable(): boolean {
    return this.kind === "server" || this.kind === "timeout" || this.kind === "network";
  }
}

/** A request to transcribe one clip. */
export type SttRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** A complete WAV file. */
  wav: Uint8Array;
  language?: string;
  /** Vocabulary hint; honoured by some providers and ignored by others. */
  prompt?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** What the provider returned. */
export type SttResult = {
  text: string;
  /** Billed audio seconds, when the provider reported them. */
  seconds?: number;
  language?: string;
};

/** Default per-request timeout, in milliseconds. */
export const STT_TIMEOUT_MS = 15_000;

/**
 * Transcribes one clip.
 *
 * @param request - The clip and where to send it.
 * @returns The text, with billed seconds when reported.
 * @throws {SttError} Classified by cause; never carries the key.
 */
export async function transcribe(request: SttRequest): Promise<SttResult> {
  const { baseUrl, apiKey, model, wav, language, prompt } = request;
  const doFetch = request.fetchImpl ?? fetch;

  const form = new FormData();
  form.append("file", new Blob([wav as unknown as ArrayBuffer], { type: "audio/wav" }), "audio.wav");
  form.append("model", model);
  form.append("response_format", "json");
  if (language) form.append("language", language);
  if (prompt) form.append("prompt", prompt);

  let res: Response;
  try {
    res = await doFetch(`${baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(request.timeoutMs ?? STT_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    throw new SttError(
      name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    );
  }

  if (res.status === 401 || res.status === 403) throw new SttError("auth", res.status);
  if (res.status === 429 || res.status >= 500) throw new SttError("server", res.status);
  if (!res.ok) throw new SttError("client", res.status);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SttError("client", res.status);
  }
  const parsed = body as {
    text?: unknown;
    language?: unknown;
    usage?: { seconds?: unknown };
  } | null;
  if (typeof parsed?.text !== "string") throw new SttError("client", res.status);

  return {
    text: parsed.text,
    seconds:
      typeof parsed.usage?.seconds === "number" ? parsed.usage.seconds : undefined,
    language: typeof parsed.language === "string" ? parsed.language : undefined,
  };
}
