/**
 * @module api/lib/time/dates
 * @description Calendar formatting in an explicit IANA timezone rather than
 * the server's.
 *
 * @important Nothing here reads the process timezone. A server running in UTC
 *            and a user in Asia/Kolkata disagree about which day 22:00 UTC
 *            belongs to, and everything the memory feature shows or ranges
 *            over depends on getting that right.
 */
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * Formats an instant in a zone, e.g. `Tue 2026-11-10 14:00`.
 *
 * @param instant - The instant.
 * @param tz - IANA timezone name.
 * @param pattern - A date-fns format pattern.
 * @returns The formatted wall-clock time in `tz`.
 */
export function formatInZone(
  instant: Date,
  tz: string,
  pattern = "EEE yyyy-MM-dd HH:mm",
): string {
  return format(new TZDate(instant.getTime(), tz), pattern);
}
