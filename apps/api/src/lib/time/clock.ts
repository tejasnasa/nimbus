/**
 * @module api/lib/time/clock
 * @description The one place the time-aware paths of NimbusBot read the time.
 * `now()` resolves, in order, a per-request override (carried with the chat
 * message and held in `AsyncLocalStorage` for the duration of the bot turn),
 * the `AGENT_NOW` environment variable, then the real clock. It exists so that
 * date-dependent behaviour ("last Tuesday", "today is …") can be tested against
 * seeded data without waiting for real days to pass.
 *
 * @important Overrides are honoured only when `NODE_ENV !== "production"`.
 *            In production `now()` is always the real clock, whatever the
 *            client sends or the environment holds: a user must never be able
 *            to move the bot's idea of "today". `NODE_ENV` is read at call
 *            time, so the guard cannot be bypassed by import order.
 *
 * @important Anything time-aware in the memory feature must call `now()`
 *            rather than `new Date()`, or an override will apply to some
 *            paths and not others.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const overrideStore = new AsyncLocalStorage<string | null>();

/**
 * Parses a clock override. A bare date means noon UTC that day so the calendar
 * date is stable in every timezone; anything unparseable is ignored rather
 * than trusted.
 *
 * @param value - An ISO date (`2026-11-10`) or a full ISO timestamp.
 * @returns The instant, or null when the value is absent or not a date.
 */
export function parseOverride(value: string | null | undefined): Date | null {
  const raw = value?.trim();
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00Z`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Runs `fn` so every `now()` call inside it sees the per-request override.
 *
 * @param override - The override carried with the request, if any.
 * @param fn - The work to run; its async continuations keep the override.
 * @returns Whatever `fn` returns.
 */
export function runWithClockOverride<T>(
  override: string | null | undefined,
  fn: () => T,
): T {
  return overrideStore.run(override ?? null, fn);
}

/**
 * The current time as NimbusBot sees it.
 *
 * @returns The request override, else `AGENT_NOW`, else the real clock; in
 *          production always the real clock.
 */
export function now(): Date {
  if (process.env.NODE_ENV === "production") return new Date();
  return (
    parseOverride(overrideStore.getStore()) ??
    parseOverride(process.env.AGENT_NOW) ??
    new Date()
  );
}
