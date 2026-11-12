/**
 * @module api/lib/memory/context
 * @description Builds the per-turn context message NimbusBot receives after
 * its fixed system prompt: today's date and time in the asker's timezone and,
 * when recall found anything, the dated block of recalled history.
 *
 * @important Everything that changes from turn to turn lives here and never in
 *            the system prompt, so the provider can cache that prompt as a
 *            stable prefix across turns.
 */
import { formatInZone } from "../time/dates";

/** Opening line that tells the model this message is context, not a person. */
export const CONTEXT_MARKER =
  "[Context for this turn, not a message from a user]";

/**
 * Renders the context message.
 *
 * @param args.now - The current time, from `now()`.
 * @param args.tz - The asker's IANA timezone.
 * @param args.recallBlock - The recalled history block; empty when none.
 * @returns Plain text beginning with {@link CONTEXT_MARKER}.
 */
export function buildContextMessage(args: {
  now: Date;
  tz: string;
  recallBlock: string;
}): string {
  const day = formatInZone(args.now, args.tz, "EEEE yyyy-MM-dd");
  const time = formatInZone(args.now, args.tz, "HH:mm");
  const lines = [
    CONTEXT_MARKER,
    `Today is ${day} (${args.tz}). Time now: ${time}.`,
  ];
  if (args.recallBlock) {
    lines.push("", "Recalled workspace history:", args.recallBlock);
  } else {
    lines.push("", "No earlier history was recalled for this message.");
  }
  return lines.join("\n");
}
