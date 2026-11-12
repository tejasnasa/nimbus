/**
 * @module agent/bargeIn
 * @description When a person talking over the assistant interrupts it.
 *
 * While the assistant is speaking, a person whose voice activity lasts
 * {@link BARGE_IN_MS} interrupts it: playback stops, the speech requests and
 * the answer stream are aborted. Anything shorter (a cough, a "mm-hm") does
 * not. The old answer is never resumed; if what the person said is itself
 * addressed to the assistant, it is answered like any other question.
 *
 * @important The agent never subscribes to its own track, and browsers keep
 *            echo cancellation on, so the assistant's own voice does not reach
 *            this policy through a person's microphone. If it ever does, the
 *            fix belongs here (an energy gate on the first moments of each
 *            sentence), not in the listener.
 */

/** How long a person must keep talking over the assistant to interrupt it. */
export const BARGE_IN_MS = 300;

/** What the policy needs from the session. */
export type BargeInOptions = {
  /** Whether the assistant is playing audio right now. */
  isSpeaking(): boolean;
  /** Stops the assistant. */
  interrupt(): void;
  thresholdMs?: number;
};

/** Interrupt policy for one session. */
export class BargeIn {
  private readonly options: BargeInOptions;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: BargeInOptions) {
    this.options = options;
  }

  /**
   * A person started talking.
   *
   * @param identity - Who.
   */
  speechStarted(identity: string): void {
    if (!this.options.isSpeaking() || this.timers.has(identity)) return;
    this.timers.set(
      identity,
      setTimeout(() => {
        this.timers.delete(identity);
        if (this.options.isSpeaking()) this.options.interrupt();
      }, this.options.thresholdMs ?? BARGE_IN_MS),
    );
  }

  /**
   * A person stopped talking.
   *
   * @param identity - Who.
   */
  speechEnded(identity: string): void {
    const timer = this.timers.get(identity);
    if (timer) clearTimeout(timer);
    this.timers.delete(identity);
  }

  /** Cancels every pending interruption. */
  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
