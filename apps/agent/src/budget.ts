/**
 * @module agent/budget
 * @description The two timers that end a session by themselves: the free-time
 * budget running out, and the room staying empty of people.
 *
 * @important The budget is measured from when the meeting started, not from when
 *            the agent joined. The API charges from the meeting's own
 *            timestamps, and the agent takes a few seconds to arrive, so a timer
 *            started at join would let the agent outlast what the user is billed
 *            for. The caller passes the time that is actually left.
 *
 * @important Both timers are advisory backstops for the server's own: the API
 *            also tells the agent to stop and removes it after the budget. They
 *            exist so a session still ends if the API is unreachable.
 */

/** How long the room may be without a human before the agent leaves. */
export const EMPTY_ROOM_MS = 60_000;

/** Timer settings and the callbacks they fire. */
export type BudgetOptions = {
  /** Milliseconds of free time left, or null when there is no limit. */
  remainingMs: number | null;
  emptyRoomMs?: number;
  onBudget(): void;
  onEmptyRoom(): void;
};

/** Budget and empty-room timers for one session. */
export class MeetingBudget {
  private readonly options: BudgetOptions;
  private budgetTimer: ReturnType<typeof setTimeout> | null = null;
  private emptyTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(options: BudgetOptions) {
    this.options = options;
  }

  /** Starts the budget timer. */
  start(): void {
    this.running = true;
    const { remainingMs } = this.options;
    if (remainingMs === null) return;
    this.budgetTimer = setTimeout(
      () => {
        this.budgetTimer = null;
        if (this.running) this.options.onBudget();
      },
      Math.max(0, remainingMs),
    );
  }

  /**
   * Tells the budget how many people are in the room. The empty-room timer runs
   * only while that number is zero.
   *
   * @param humans - Participants other than agents.
   */
  setHumans(humans: number): void {
    if (!this.running) return;
    if (humans > 0) {
      this.clearEmpty();
      return;
    }
    if (this.emptyTimer) return;
    this.emptyTimer = setTimeout(() => {
      this.emptyTimer = null;
      if (this.running) this.options.onEmptyRoom();
    }, this.options.emptyRoomMs ?? EMPTY_ROOM_MS);
  }

  private clearEmpty(): void {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  /** Cancels both timers. */
  stop(): void {
    this.running = false;
    if (this.budgetTimer) clearTimeout(this.budgetTimer);
    this.budgetTimer = null;
    this.clearEmpty();
  }
}
