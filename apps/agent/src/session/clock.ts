/**
 * @module agent/session/clock
 * @description Meeting time: milliseconds since the meeting started, as the
 * API recorded it.
 *
 * @important The wall clock is read once, when the clock is created, to learn
 *            how long the meeting had already been running; from then on time
 *            advances on the monotonic clock. A wall-clock step (NTP, a VM
 *            resume) in the middle of a call therefore cannot reorder captions
 *            or make an utterance end before it began.
 */

/** A source of meeting time. */
export type MeetingClock = {
  /** Milliseconds since the meeting started. */
  elapsedMs(): number;
};

/**
 * Creates a meeting clock.
 *
 * @param startedAtIso - When the meeting started, from the API (ISO timestamp).
 * @param sources.wall - Epoch milliseconds. Tests only.
 * @param sources.mono - Monotonic milliseconds. Tests only.
 */
export function createMeetingClock(
  startedAtIso: string,
  sources: { wall?: () => number; mono?: () => number } = {},
): MeetingClock {
  const wall = sources.wall ?? Date.now;
  const mono = sources.mono ?? (() => performance.now());
  const offsetAtCreate = Math.max(0, wall() - Date.parse(startedAtIso));
  const monoAtCreate = mono();
  return {
    elapsedMs: () => offsetAtCreate + (mono() - monoAtCreate),
  };
}
