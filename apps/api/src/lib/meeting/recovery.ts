/**
 * @module api/lib/meeting/recovery
 * @description The sweep that finishes notes the first attempt did not: a
 * restart that lost the queued run, a model that was down, a reply that did not
 * validate.
 *
 * @important A meeting is retried only while it is `ENDED` or `FAILED`, ended
 *            more than a minute ago (the first attempt gets its chance) and has
 *            fewer than {@link NOTES_MAX_ATTEMPTS} attempts. After the third it
 *            stays `FAILED` with its reason and its transcript, and the sweep
 *            leaves it alone. A meeting whose assistant never started
 *            (`dispatch-failed`) has nothing to summarise and is skipped.
 *
 * @important The interval is unref'd, so it never keeps the process alive, and
 *            {@link startNotesRecovery} returns a stop function for tests.
 */
import { prisma } from "@nimbus/db";
import type { MeetingBroadcaster } from "./lifecycle";
import { NOTES_MAX_ATTEMPTS, writeNotes, type NotesDeps } from "./notes";

/** How often the sweep runs. */
export const RECOVERY_INTERVAL_MS = 10 * 60 * 1000;

/** How long after a meeting ends before the sweep may retry it. */
export const RECOVERY_MIN_AGE_MS = 60 * 1000;

/** The most meetings one sweep works through. */
const SWEEP_BATCH = 20;

/** Inputs of a sweep. Tests only, except `io`. */
export type RecoveryDeps = NotesDeps & {
  io?: MeetingBroadcaster;
  /** The clock in milliseconds. */
  now?: () => number;
};

/**
 * Retries the notes of every meeting that is due.
 *
 * @param deps - Broadcaster and test seams.
 * @returns How many meetings were attempted.
 */
export async function recoverPendingNotes(
  deps: RecoveryDeps = {},
): Promise<number> {
  const cutoff = new Date((deps.now ?? Date.now)() - RECOVERY_MIN_AGE_MS);
  const due = await prisma.meeting.findMany({
    where: {
      status: { in: ["ENDED", "FAILED"] },
      endedAt: { lt: cutoff },
      summaryAttempts: { lt: NOTES_MAX_ATTEMPTS },
      OR: [{ endReason: null }, { endReason: { not: "dispatch-failed" } }],
    },
    orderBy: { endedAt: "asc" },
    take: SWEEP_BATCH,
    select: { id: true },
  });
  for (const meeting of due) {
    await writeNotes(meeting.id, deps);
  }
  return due.length;
}

/**
 * Runs {@link recoverPendingNotes} now, without blocking the caller, and then
 * every {@link RECOVERY_INTERVAL_MS}. A failing sweep is logged and the next
 * one still runs.
 *
 * @param deps - Broadcaster and test seams.
 * @returns A function that stops the interval.
 */
export function startNotesRecovery(deps: RecoveryDeps = {}): () => void {
  const sweep = () => {
    void recoverPendingNotes(deps).catch((error: unknown) => {
      console.error(
        "[meeting] notes recovery failed:",
        error instanceof Error ? error.name : "unknown error",
      );
    });
  };
  sweep();
  const timer = setInterval(sweep, RECOVERY_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
