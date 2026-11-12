/**
 * @module agent/stt/transcriber
 * @description Turns finished utterances into ordered transcript segments.
 *
 * Utterances are numbered when they are submitted, which is when the speaker
 * stopped, so the numbering follows the order people finished speaking in.
 * Requests run up to three at a time and finish in any order; results are
 * released strictly by number, so captions never reorder.
 *
 * @important A result waits for the ones before it, but never forever: if an
 *            earlier utterance has not resolved within `orderTimeoutMs`, it is
 *            skipped and the queue moves on. A failed request is retried once
 *            (server error, timeout or lost connection) and then skipped; a
 *            rejected key stops transcription for the session and is reported
 *            through `onFatal`, because every later request would fail the same
 *            way.
 *
 * @important Every request, including failures and results the filter drops, is
 *            reported through `onUsage`: the provider billed for them, and the
 *            workspace's call log should say so.
 */
import type { SegmentIn, UsageIn } from "@nimbus/types";
import { rmsEnergy } from "../audio/energy.js";
import { encodeWav } from "../audio/wav.js";
import { isHallucination } from "./hallucinationFilter.js";
import { SttError, transcribe, type SttRequest, type SttResult } from "./openaiCompatibleStt.js";

/** Concurrent transcription requests. */
export const TRANSCRIBE_CONCURRENCY = 3;

/** Longest a result waits for earlier ones, in milliseconds. */
export const ORDER_TIMEOUT_MS = 5000;

/** Pause before the single retry, in milliseconds. */
export const RETRY_DELAY_MS = 500;

/** One utterance to transcribe. */
export type TranscriptionJob = {
  userId: string | null;
  name: string;
  startMs: number;
  endMs: number;
  pcm: Int16Array;
  /** Spoken under the Ask button, so addressed whatever the words. */
  asked?: boolean;
};

/** What the transcriber needs from its surroundings. */
export type TranscriberOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  language?: string;
  /** Vocabulary hint sent with each request. */
  prompt?: string;
  /** Spelling repair applied to each result. */
  glossary: (text: string) => string;
  /**
   * A segment, released in sequence order. `asked` is true when it was spoken
   * under the Ask button.
   */
  onSegment(segment: SegmentIn, asked: boolean): void;
  /** A provider request, for the call log. */
  onUsage(entry: UsageIn): void;
  /** The key was rejected; transcription cannot continue. */
  onFatal(reason: "invalid-key"): void;
  sampleRate?: number;
  concurrency?: number;
  orderTimeoutMs?: number;
  retryDelayMs?: number;
  /** The request function. Tests only. */
  stt?: (request: SttRequest) => Promise<SttResult>;
  /** The clock in milliseconds. Tests only. */
  now?: () => number;
};

/** Queue of utterances in, ordered segments out. */
export class Transcriber {
  private readonly options: TranscriberOptions;
  private readonly sampleRate: number;
  private readonly concurrency: number;
  private readonly orderTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly stt: (request: SttRequest) => Promise<SttResult>;
  private readonly now: () => number;

  private nextSeq = 1;
  private nextToEmit = 1;
  private readonly waiting: Array<() => Promise<void>> = [];
  private running = 0;
  private readonly results = new Map<
    number,
    { segment: SegmentIn; asked: boolean } | null
  >();
  private readonly pending = new Set<Promise<void>>();
  private headTimer: ReturnType<typeof setTimeout> | null = null;
  private fatal = false;

  constructor(options: TranscriberOptions) {
    this.options = options;
    this.sampleRate = options.sampleRate ?? 16_000;
    this.concurrency = options.concurrency ?? TRANSCRIBE_CONCURRENCY;
    this.orderTimeoutMs = options.orderTimeoutMs ?? ORDER_TIMEOUT_MS;
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    this.stt = options.stt ?? transcribe;
    this.now = options.now ?? Date.now;
  }

  /**
   * Queues an utterance. The sequence number is assigned here, at the end of
   * speech.
   *
   * @param job - The utterance and who spoke it.
   * @returns Its sequence number.
   */
  submit(job: TranscriptionJob): number {
    const seq = this.nextSeq++;
    if (this.fatal) {
      this.settle(seq, null);
      return seq;
    }
    let done!: () => void;
    const tracked = new Promise<void>((resolve) => {
      done = resolve;
    });
    this.pending.add(tracked);
    this.waiting.push(async () => {
      try {
        await this.process(seq, job);
      } finally {
        this.pending.delete(tracked);
        done();
      }
    });
    this.dispatch();
    return seq;
  }

  /**
   * Takes a sequence number without an utterance, for a caption the API will
   * store itself (the assistant's reply). The number is released at once, so
   * it never holds back the captions after it.
   *
   * @returns The reserved number.
   */
  reserveSeq(): number {
    const seq = this.nextSeq++;
    this.settle(seq, null);
    return seq;
  }

  /**
   * Waits for everything submitted so far to be emitted or skipped.
   *
   * @param timeoutMs - How long to wait at most.
   * @returns True if everything finished, false if the wait timed out.
   */
  async flush(timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const finished = Promise.all([...this.pending]).then(() => true);
    try {
      return await Promise.race([finished, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Cancels the ordering timer. Call when the session ends. */
  close(): void {
    if (this.headTimer) clearTimeout(this.headTimer);
    this.headTimer = null;
  }

  private dispatch(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const task = this.waiting.shift()!;
      this.running += 1;
      void task().finally(() => {
        this.running -= 1;
        this.dispatch();
      });
    }
  }

  private async process(seq: number, job: TranscriptionJob): Promise<void> {
    if (this.fatal) {
      this.settle(seq, null);
      return;
    }
    const { baseUrl, apiKey, model, language, prompt } = this.options;
    const audioSeconds = job.pcm.length / this.sampleRate;
    const wav = encodeWav(job.pcm, this.sampleRate);
    const rms = rmsEnergy(job.pcm);

    for (let attempt = 0; attempt < 2; attempt++) {
      const startedAt = this.now();
      try {
        const result = await this.stt({
          baseUrl,
          apiKey,
          model,
          wav,
          language,
          prompt,
        });
        this.options.onUsage({
          feature: "transcription",
          model,
          audioSeconds: result.seconds ?? audioSeconds,
          latencyMs: this.now() - startedAt,
          status: "OK",
        });

        const text = result.text.trim();
        if (isHallucination(text, rms)) {
          this.settle(seq, null);
          return;
        }
        this.settle(seq, {
          segment: {
            seq,
            speakerUserId: job.userId,
            speakerName: job.name,
            text: this.options.glossary(text),
            startMs: Math.max(0, Math.round(job.startMs)),
            endMs: Math.max(0, Math.round(job.endMs)),
            language: result.language ?? language,
          },
          asked: job.asked === true,
        });
        return;
      } catch (error) {
        const failure =
          error instanceof SttError ? error : new SttError("network");
        this.options.onUsage({
          feature: "transcription",
          model,
          audioSeconds: 0,
          latencyMs: this.now() - startedAt,
          status: "ERROR",
          errorReason:
            failure.kind === "auth"
              ? "invalid-key"
              : failure.kind === "timeout"
                ? "timeout"
                : "provider-error",
        });

        if (failure.kind === "auth") {
          this.fatal = true;
          this.options.onFatal("invalid-key");
          break;
        }
        if (!failure.retryable || attempt === 1) break;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      }
    }
    this.settle(seq, null);
  }

  /** Records a result and releases everything that is now in order. */
  private settle(
    seq: number,
    result: { segment: SegmentIn; asked: boolean } | null,
  ): void {
    if (seq < this.nextToEmit) return;
    this.results.set(seq, result);
    this.drain();
  }

  private drain(): void {
    while (this.results.has(this.nextToEmit)) {
      const result = this.results.get(this.nextToEmit)!;
      this.results.delete(this.nextToEmit);
      this.nextToEmit += 1;
      if (result) this.options.onSegment(result.segment, result.asked);
    }

    if (this.headTimer) {
      clearTimeout(this.headTimer);
      this.headTimer = null;
    }
    if (this.results.size > 0) {
      // Something later is ready but an earlier utterance is still out. Give it
      // a bounded time rather than holding every caption behind it.
      this.headTimer = setTimeout(() => {
        this.headTimer = null;
        this.results.set(this.nextToEmit, null);
        this.drain();
      }, this.orderTimeoutMs);
    }
  }
}
