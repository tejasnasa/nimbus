/**
 * @module agent/audio/utteranceBuffer
 * @description Collects the audio between a participant's start and end of
 * speech into one utterance.
 *
 * The voice activity model reports speech only after a minimum duration has
 * already gone by, and reports its end only after a stretch of silence. Its
 * events carry no audio worth keeping, but they do carry the index of the sample
 * at which they fired. The buffer records every frame itself and cuts the
 * utterance out by those indices: the speech that came before the start event is
 * recovered from recent history, and the silence that triggered the end event is
 * trimmed back to a small tail.
 *
 * @important Cutting is by sample index, not by "now". The detector runs behind
 *            the audio (milliseconds when the machine is idle, more under load),
 *            so by the time an event arrives the buffer has already taken in
 *            audio past it. Indices make the cut exact however far behind the
 *            detector is, as long as the history reaches back far enough
 *            (`retainMs`).
 *
 * @important Times are stamped from the clock reading that came with each frame,
 *            not derived from the sample count. A muted microphone delivers no
 *            frames, so counting samples would fall behind the wall clock and
 *            stamp captions with the wrong time. Times are milliseconds from the
 *            start of the meeting.
 *
 * @important An utterance is force-cut after `maxMs` of continuous speech and
 *            listening carries on, so a long monologue still produces captions
 *            as it goes. An utterance with less than `minUtteranceMs` of actual
 *            speech (the lead-in and the tail do not count) is dropped: it is a
 *            cough or a click, and transcribing it only invites invented text.
 */

/** One cut-out stretch of a participant's speech. */
export type Utterance = {
  /** Meeting time of the first sample, in milliseconds. */
  startMs: number;
  /** Meeting time just after the last sample, in milliseconds. */
  endMs: number;
  /** Mono 16-bit samples at the buffer's sample rate. */
  pcm: Int16Array;
};

/** Tunables; the defaults are the ones the agent runs with. */
export type UtteranceBufferOptions = {
  sampleRate?: number;
  /** The detector's minimum speech duration, already elapsed at its start event. */
  minSpeechMs?: number;
  /** Audio kept from before the speech, so the first word is not clipped. */
  prefixMs?: number;
  /** The detector's silence duration, which has elapsed at its end event. */
  minSilenceMs?: number;
  /** Silence kept after the speech. */
  tailPadMs?: number;
  /** Longest continuous utterance before it is cut and listening continues. */
  maxMs?: number;
  /** Shortest amount of speech worth transcribing. */
  minUtteranceMs?: number;
  /** How far back history is kept while nobody is speaking. */
  retainMs?: number;
};

type Chunk = {
  /** Index of the chunk's first sample in the whole stream. */
  startIndex: number;
  samples: Int16Array;
  /** Meeting time at the end of the chunk. */
  endMs: number;
};

/** Longest utterance before a force-cut, in milliseconds. */
export const MAX_UTTERANCE_MS = 20_000;

/** Least speech worth transcribing, in milliseconds. */
export const MIN_UTTERANCE_MS = 400;

/** Stateful collector for one participant's audio. */
export class UtteranceBuffer {
  private readonly rate: number;
  private readonly minSpeech: number;
  private readonly prefix: number;
  private readonly minSilence: number;
  private readonly tailPad: number;
  private readonly max: number;
  private readonly minUtterance: number;
  private readonly retain: number;

  private chunks: Chunk[] = [];
  private total = 0;
  private openFrom: number | null = null;
  private leadSamples = 0;

  constructor(options: UtteranceBufferOptions = {}) {
    this.rate = options.sampleRate ?? 16_000;
    const samples = (ms: number) => Math.round((ms / 1000) * this.rate);
    this.minSpeech = samples(options.minSpeechMs ?? 250);
    this.prefix = samples(options.prefixMs ?? 300);
    this.minSilence = samples(options.minSilenceMs ?? 600);
    this.tailPad = samples(options.tailPadMs ?? 200);
    this.max = samples(options.maxMs ?? MAX_UTTERANCE_MS);
    this.minUtterance = samples(options.minUtteranceMs ?? MIN_UTTERANCE_MS);
    this.retain = samples(options.retainMs ?? 8000);
  }

  /** Whether an utterance is being collected. */
  get speaking(): boolean {
    return this.openFrom !== null;
  }

  /** Total samples taken in so far; the index the next sample will have. */
  get position(): number {
    return this.total;
  }

  /**
   * Feeds one frame of audio.
   *
   * @param samples - Mono 16-bit samples.
   * @param endAtMs - Meeting time at the end of this frame.
   * @returns Utterances force-cut by this frame; normally none.
   */
  pushFrame(samples: Int16Array, endAtMs: number): Utterance[] {
    this.chunks.push({ startIndex: this.total, samples, endMs: endAtMs });
    this.total += samples.length;

    const cuts: Utterance[] = [];
    if (this.openFrom !== null && this.total - this.openFrom >= this.max) {
      const cut = this.cut(this.openFrom, this.total, this.leadSamples, 0);
      if (cut) cuts.push(cut);
      this.openFrom = this.total;
      this.leadSamples = 0;
    }
    this.prune();
    return cuts;
  }

  /**
   * Marks the detector's start of speech: begin collecting.
   *
   * @param atIndex - The sample index the event carried; defaults to the latest.
   */
  startSpeech(atIndex?: number): void {
    if (this.openFrom !== null) return;
    const event = Math.min(atIndex ?? this.total, this.total);
    const oldest = this.chunks[0]?.startIndex ?? this.total;
    const wanted = event - this.minSpeech - this.prefix;
    this.openFrom = Math.max(oldest, wanted);
    this.leadSamples = Math.max(0, event - this.minSpeech - this.openFrom);
  }

  /**
   * Marks the detector's end of speech: cut the utterance.
   *
   * @param atIndex - The sample index the event carried; defaults to the latest.
   * @returns The utterance, or null when nothing was being collected or it held
   *          too little speech.
   */
  endSpeech(atIndex?: number): Utterance | null {
    if (this.openFrom === null) return null;
    const event = Math.min(atIndex ?? this.total, this.total);
    const end = Math.min(this.total, event - (this.minSilence - this.tailPad));
    const result = this.cut(this.openFrom, end, this.leadSamples, this.tailPad);
    this.openFrom = null;
    this.leadSamples = 0;
    this.prune();
    return result;
  }

  /**
   * Cuts whatever is open without waiting for the detector, for a participant
   * who left or a session that is stopping.
   */
  flush(): Utterance | null {
    if (this.openFrom === null) return null;
    const result = this.cut(this.openFrom, this.total, this.leadSamples, 0);
    this.openFrom = null;
    this.leadSamples = 0;
    this.prune();
    return result;
  }

  /** Drops history nothing can need any more. */
  private prune(): void {
    const keepFrom = this.openFrom ?? this.total - this.retain;
    while (this.chunks.length > 1) {
      const first = this.chunks[0]!;
      if (first.startIndex + first.samples.length > keepFrom) break;
      this.chunks.shift();
    }
  }

  /** Meeting time at a sample index, from the clock reading of its chunk. */
  private timeAt(index: number): number {
    const chunk =
      this.chunks.find(
        (c) => index >= c.startIndex && index <= c.startIndex + c.samples.length,
      ) ?? this.chunks[this.chunks.length - 1];
    if (!chunk) return 0;
    const chunkStartMs = chunk.endMs - (chunk.samples.length / this.rate) * 1000;
    return chunkStartMs + ((index - chunk.startIndex) / this.rate) * 1000;
  }

  /**
   * Builds the utterance for `[from, to)`.
   *
   * @param lead - Samples at the start that are lead-in, not speech.
   * @param tail - Samples at the end that are padding, not speech.
   */
  private cut(from: number, to: number, lead: number, tail: number): Utterance | null {
    const oldest = this.chunks[0]?.startIndex ?? from;
    const start = Math.max(from, oldest);
    if (to <= start) return null;
    if (to - start - lead - tail < this.minUtterance) return null;

    const pcm = new Int16Array(to - start);
    for (const chunk of this.chunks) {
      const chunkEnd = chunk.startIndex + chunk.samples.length;
      if (chunkEnd <= start || chunk.startIndex >= to) continue;
      const a = Math.max(start, chunk.startIndex);
      const b = Math.min(to, chunkEnd);
      pcm.set(
        chunk.samples.subarray(a - chunk.startIndex, b - chunk.startIndex),
        a - start,
      );
    }
    return {
      startMs: Math.max(0, this.timeAt(start)),
      endMs: this.timeAt(to),
      pcm,
    };
  }
}
