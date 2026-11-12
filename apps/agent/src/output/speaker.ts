/**
 * @module agent/output/speaker
 * @description The assistant's mouth: turns a stream of answer text into audio
 * on the agent's published track, and stops at once when interrupted.
 *
 * Text is cut into sentences as it arrives. The first sentence goes to speech
 * synthesis immediately, and while sentence N plays, sentence N+1 is already
 * being synthesized (a two-slot pipeline), which keeps playback gap-free since
 * synthesis runs faster than real time. Samples are cut into 20 ms frames and
 * queued on the output. A sentence's leading silence is trimmed, because some
 * models open every clip with up to a few seconds of it.
 *
 * State changes go to `onState`: `speaking` at the first frame of an answer,
 * `listening` once the queue has drained or the answer was interrupted.
 *
 * @important {@link Speaker.interrupt} aborts the speech requests and the text
 *            stream (through the signal the caller gave {@link Speaker.speak}),
 *            and clears the output's queue, so audio already queued stops
 *            within a frame rather than playing out.
 *
 * @important A sentence whose synthesis fails is skipped, not retried: by the
 *            time a retry returned, the moment for it would have passed.
 *            {@link Speaker.speak} never throws.
 */
import { sentences } from "../tts/sentenceSplitter.js";
import type { TtsAudio } from "../tts/openaiCompatibleTts.js";

/** Length of one audio frame, in milliseconds. */
export const FRAME_MS = 20;

/** Samples below this magnitude count as silence when trimming. */
const SILENCE_LEVEL = 400;

/** Most leading silence trimmed from one sentence, in seconds. */
const MAX_TRIM_SECONDS = 3;

/** Earcon length and pitch. */
export const EARCON_MS = 150;
const EARCON_HZ = 880;

/** Where frames go. The real one is a published LiveKit audio track. */
export interface AudioOutput {
  /**
   * Queues one frame of mono 16-bit samples at `sampleRate`; resolves when
   * there is room for more. The output converts the rate if it must.
   */
  captureFrame(samples: Int16Array, sampleRate: number): Promise<void>;
  /** Drops everything queued. */
  clearQueue(): void;
  /** Resolves when everything queued has played. */
  waitForPlayout(): Promise<void>;
}

/** What the speaker needs from outside. */
export type SpeakerOptions = {
  output: AudioOutput;
  /** Synthesizes one sentence. */
  synthesize(text: string, signal: AbortSignal): Promise<TtsAudio>;
  /** Reports `speaking` and `listening`. */
  onState(state: "speaking" | "listening"): void;
};

/** How an answer ended. */
export type SpeakOutcome = "finished" | "interrupted";

/** A sentence whose audio is being fetched in the background. */
type Prefetched = {
  sampleRate: Promise<number>;
  samples(): AsyncGenerator<Int16Array>;
};

/**
 * Starts reading a synthesized sentence immediately, buffering its samples
 * until they are played. A failed synthesis yields no samples.
 */
function prefetch(audio: Promise<TtsAudio>): Prefetched {
  const buffered: Int16Array[] = [];
  let done = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  const sampleRate = audio.then(
    (a) => a.sampleRate,
    () => 0,
  );
  void (async () => {
    try {
      const { chunks } = await audio;
      for await (const chunk of chunks) {
        buffered.push(chunk);
        notify();
      }
    } catch {
      // Skipped: see the module notes.
    } finally {
      done = true;
      notify();
    }
  })();

  return {
    sampleRate,
    async *samples() {
      for (;;) {
        const next = buffered.shift();
        if (next) {
          yield next;
          continue;
        }
        if (done) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

/** Removes leading samples below the silence level, up to `max` samples. */
function trimLeading(
  samples: Int16Array,
  max: number,
): { rest: Int16Array; trimmed: number } {
  let i = 0;
  while (i < samples.length && i < max && Math.abs(samples[i]!) < SILENCE_LEVEL)
    i++;
  return { rest: samples.subarray(i), trimmed: i };
}

/** Plays answers on one output. */
export class Speaker {
  private readonly options: SpeakerOptions;
  private current: AbortController | null = null;
  private playing = false;

  constructor(options: SpeakerOptions) {
    this.options = options;
  }

  /** Whether audio of an answer is playing right now. */
  get speaking(): boolean {
    return this.playing;
  }

  /** Whether an answer is in progress, playing or still waiting for audio. */
  get busy(): boolean {
    return this.current !== null;
  }

  /**
   * Speaks a stream of text. A call while another answer is in progress
   * interrupts that one first.
   *
   * @param text - The answer's text deltas.
   * @param signal - Aborted by the caller to stop; also aborts synthesis.
   * @returns How the answer ended. Never throws.
   */
  async speak(
    text: AsyncIterable<string>,
    signal?: AbortSignal,
  ): Promise<SpeakOutcome> {
    if (this.current) this.interrupt();
    const controller = new AbortController();
    this.current = controller;
    const stop = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const pending = sentences(text)[Symbol.asyncIterator]();

    const startNext = async (): Promise<Prefetched | null> => {
      if (stop.aborted) return null;
      let next: IteratorResult<string>;
      try {
        next = await pending.next();
      } catch {
        return null;
      }
      if (next.done || stop.aborted) return null;
      return prefetch(this.options.synthesize(next.value, stop));
    };

    let interrupted = false;
    try {
      let current = await startNext();
      while (current && !stop.aborted) {
        // The second slot: the next sentence synthesizes while this one plays.
        const upcoming = startNext();
        await this.play(current, stop);
        current = await upcoming;
      }
      if (!stop.aborted && this.playing)
        await this.options.output.waitForPlayout();
    } catch {
      // A broken output ends the answer; the session carries on.
    } finally {
      interrupted = stop.aborted;
      if (interrupted) this.options.output.clearQueue();
      void pending.return?.(undefined).catch(() => undefined);
      if (this.current === controller) this.current = null;
      if (this.playing) {
        this.playing = false;
        this.options.onState("listening");
      }
    }
    return interrupted ? "interrupted" : "finished";
  }

  /**
   * Speaks one fixed sentence.
   *
   * @param text - What to say.
   */
  say(text: string): Promise<SpeakOutcome> {
    return this.speak(
      (async function* () {
        yield text;
      })(),
    );
  }

  /** Plays one prefetched sentence as 20 ms frames. */
  private async play(sentence: Prefetched, stop: AbortSignal): Promise<void> {
    const rate = await sentence.sampleRate;
    if (rate <= 0) return;
    const frameSize = Math.round((rate * FRAME_MS) / 1000);
    const frame = new Int16Array(frameSize);
    let filled = 0;
    let trimBudget = rate * MAX_TRIM_SECONDS;

    for await (let chunk of sentence.samples()) {
      if (stop.aborted) return;
      if (trimBudget > 0) {
        const { rest, trimmed } = trimLeading(chunk, trimBudget);
        trimBudget = rest.length > 0 ? 0 : trimBudget - trimmed;
        chunk = rest;
      }
      let offset = 0;
      while (offset < chunk.length) {
        const take = Math.min(frameSize - filled, chunk.length - offset);
        frame.set(chunk.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === frameSize) {
          await this.emit(frame.slice(), rate, stop);
          if (stop.aborted) return;
          filled = 0;
        }
      }
    }
    if (filled > 0 && !stop.aborted) {
      const last = new Int16Array(frameSize);
      last.set(frame.subarray(0, filled));
      await this.emit(last, rate, stop);
    }
  }

  private async emit(
    frame: Int16Array,
    rate: number,
    stop: AbortSignal,
  ): Promise<void> {
    if (stop.aborted) return;
    if (!this.playing) {
      this.playing = true;
      this.options.onState("speaking");
    }
    await this.options.output.captureFrame(frame, rate);
  }

  /** Stops the answer in progress, if any. */
  interrupt(): void {
    const current = this.current;
    if (!current) return;
    current.abort();
    this.options.output.clearQueue();
  }

  /**
   * Plays a short tone: the cue that the assistant heard its name and is
   * waiting for the question. Does nothing while an answer is in progress.
   *
   * @param sampleRate - The rate to synthesize the tone at.
   */
  async chime(sampleRate = 24_000): Promise<void> {
    if (this.current) return;
    const frameSize = Math.round((sampleRate * FRAME_MS) / 1000);
    const total = Math.round((sampleRate * EARCON_MS) / 1000);
    const fade = Math.round(sampleRate * 0.01);
    try {
      for (let start = 0; start < total; start += frameSize) {
        const frame = new Int16Array(frameSize);
        for (let i = 0; i < frameSize && start + i < total; i++) {
          const n = start + i;
          const envelope = Math.min(1, n / fade, (total - n) / fade);
          frame[i] = Math.round(
            Math.sin((2 * Math.PI * EARCON_HZ * n) / sampleRate) *
              6000 *
              envelope,
          );
        }
        await this.options.output.captureFrame(frame, sampleRate);
      }
    } catch {
      // A missed chime is harmless.
    }
  }
}
