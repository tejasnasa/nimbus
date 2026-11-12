/**
 * @module web/lib/chatClock
 * @description The time context a chat message carries to the API: the
 * viewer's IANA timezone, so NimbusBot resolves "on Tuesday" in the viewer's
 * own day, and an optional clock override for testing date handling.
 *
 * To try date-aware answers against seeded data in a development build, set
 * `localStorage["nimbus:agent-now"]` to an ISO date (`2026-11-11`) or a full
 * timestamp. There is no UI for it.
 *
 * @important The override is read and sent only when
 *            `process.env.NODE_ENV !== "production"`. This is a convenience,
 *            not a guard: the API ignores the field in production regardless.
 */

/** The `localStorage` key holding the development clock override. */
export const CLOCK_OVERRIDE_STORAGE_KEY = "nimbus:agent-now";

/**
 * The viewer's IANA timezone.
 *
 * @returns The browser's timezone name, or undefined when it cannot be read.
 */
export function getViewerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The development clock override, if one is set.
 *
 * @returns The stored value outside production; undefined in production or
 *          when nothing (or no storage) is available.
 */
export function getClockOverride(): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  try {
    return (
      localStorage.getItem(CLOCK_OVERRIDE_STORAGE_KEY)?.trim() || undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * The time fields to spread into a `message:send` payload.
 *
 * @returns `timeZone` when known, and `clockOverride` outside production when set.
 */
export function chatTimeContext(): {
  timeZone?: string;
  clockOverride?: string;
} {
  const timeZone = getViewerTimeZone();
  const clockOverride = getClockOverride();
  return {
    ...(timeZone ? { timeZone } : {}),
    ...(clockOverride ? { clockOverride } : {}),
  };
}
