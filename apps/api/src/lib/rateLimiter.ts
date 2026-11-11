/**
 * @module api/lib/rateLimiter
 * @description Tiny in-process limiter for chatty socket events (cursor and
 * pointer streams), where dropping the excess is the right response.
 */

/**
 * Fixed-window rate limiter.
 *
 * @param max - Calls allowed per window.
 * @param windowMs - Window length in milliseconds.
 * @param now - Clock; injectable so tests need no real waiting.
 * @returns A function that returns `true` while the caller is within budget.
 */
export const createRateLimiter = (
  max: number,
  windowMs: number,
  now: () => number = Date.now,
): (() => boolean) => {
  let windowStart = now();
  let used = 0;
  return () => {
    const t = now();
    if (t - windowStart >= windowMs) {
      windowStart = t;
      used = 0;
    }
    used += 1;
    return used <= max;
  };
};
