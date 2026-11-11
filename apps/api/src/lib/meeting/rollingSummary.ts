/**
 * @module api/lib/meeting/rollingSummary
 * @description The running summary of a live meeting, kept fresh as captions
 * arrive and returned by "catch me up".
 *
 * A roll is due when at least {@link ROLL_MIN_SEGMENTS} captions are new since
 * the summary last advanced, or when at least {@link ROLL_MIN_INTERVAL_MS} have
 * passed and there is at least one. The model gets the previous summary and
 * only the new captions, and returns an updated bullet-point summary of at most
 * 150 words, so the cost of a roll does not grow with the length of the call.
 *
 * @important A Redis lock (`meeting:<id>:rolling`, 60 seconds) lets exactly one
 *            roll run per meeting at a time, across replicas. A caller that
 *            loses the lock does nothing.
 *
 * @important {@link maybeRoll} is called detached after every ingest and never
 *            throws; a failed roll leaves the stored summary untouched, so the
 *            next ingest tries again. The position (`rollingSummarySeq`) only
 *            moves forward, and the write is conditional on the meeting still
 *            existing and being live, so a deleted or finished meeting is left
 *            alone.
 *
 * @important {@link getCatchUp} regenerates synchronously only when the stored
 *            summary is older than {@link CATCH_UP_STALE_MS} and captions have
 *            arrived since; otherwise it returns what is stored.
 */
import { prisma } from "@nimbus/db";
import type { CatchUpDTO } from "@nimbus/types";
import { withAiCall, recordAiRefusal } from "../ai/callLog";
import { reasoningKwargs } from "../ai/clientFactory";
import { resolveAi } from "../ai/entitlements";
import { pubClient } from "../redis";
import { responseText } from "./modelText";

/** New captions that make a roll due. */
export const ROLL_MIN_SEGMENTS = 20;

/** Time, with at least one new caption, that makes a roll due. */
export const ROLL_MIN_INTERVAL_MS = 3 * 60 * 1000;

/** How old the stored summary may be before catch-up regenerates it. */
export const CATCH_UP_STALE_MS = 90 * 1000;

/** How long a roll may hold its lock, in seconds. */
export const ROLL_LOCK_TTL_SECONDS = 60;

/** The most new captions one roll reads; the rest wait for the next. */
const ROLL_BATCH = 150;

/** Hard cap for the summary response. */
const ROLL_MAX_OUTPUT_TOKENS = 600;

/** Longest summary stored, in characters. */
const ROLL_MAX_CHARS = 1500;

/** Redis key of the roll lock. */
export const rollLockKey = (meetingId: string) =>
  `meeting:${meetingId}:rolling`;

/** Seams for the pieces that talk to the outside world. Tests only. */
export type RollDeps = {
  /** Replaces the model resolver. */
  resolve?: typeof resolveAi;
  /** The clock in milliseconds. */
  now?: () => number;
};

/** What a roll did. */
export type RollOutcome =
  | "rolled"
  | "not-due"
  | "locked"
  | "ignored"
  | "failed";

/**
 * Whether a roll is due.
 *
 * @param newSegments - Captions since the summary last advanced.
 * @param sinceMs - Milliseconds since it last advanced (or the meeting began).
 */
export function isRollDue(newSegments: number, sinceMs: number): boolean {
  if (newSegments >= ROLL_MIN_SEGMENTS) return true;
  return newSegments >= 1 && sinceMs >= ROLL_MIN_INTERVAL_MS;
}

/** The instructions sent with every roll. */
export const ROLL_INSTRUCTIONS = `You keep a running summary of a meeting that is still in progress, so someone who joins late can catch up.

You are given the previous summary (possibly empty) and the captions spoken since. Return the updated summary: at most 150 words, as short bullet points ("- ..."), covering the topics discussed, decisions made so far, and open questions. Fold the new captions into what is already there; drop detail that no longer matters rather than growing. Write only the bullet points, with no preamble.`;

/** Refusals already logged, so a capped workspace logs one per meeting. */
const refusalLogged = new Set<string>();

type RollMeeting = {
  id: string;
  workspaceId: string;
  startedById: string | null;
  startedAt: Date;
  rollingSummary: string | null;
  rollingSummarySeq: number;
  rollingSummaryAt: Date | null;
};

/** Reads a live meeting's summary state; null when it is gone or not live. */
async function loadLive(meetingId: string): Promise<RollMeeting | null> {
  return prisma.meeting.findFirst({
    where: { id: meetingId, status: "LIVE" },
    select: {
      id: true,
      workspaceId: true,
      startedById: true,
      startedAt: true,
      rollingSummary: true,
      rollingSummarySeq: true,
      rollingSummaryAt: true,
    },
  });
}

/** Rolls the summary under the lock. Never throws. */
async function roll(
  meetingId: string,
  mode: { force: boolean },
  deps: RollDeps,
): Promise<RollOutcome> {
  let locked = false;
  try {
    const meeting = await loadLive(meetingId);
    if (!meeting) return "ignored";

    const now = (deps.now ?? Date.now)();
    const fresh = await prisma.transcriptSegment.count({
      where: { meetingId, seq: { gt: meeting.rollingSummarySeq } },
    });
    if (fresh === 0) return "not-due";
    const since =
      now - (meeting.rollingSummaryAt ?? meeting.startedAt).getTime();
    if (!mode.force && !isRollDue(fresh, since)) return "not-due";

    const claimed = await pubClient.set(
      rollLockKey(meetingId),
      "1",
      "EX",
      ROLL_LOCK_TTL_SECONDS,
      "NX",
    );
    if (claimed !== "OK") return "locked";
    locked = true;

    // Re-read under the lock: the roll that held it may have just advanced.
    const current = await loadLive(meetingId);
    if (!current) return "ignored";
    const segments = await prisma.transcriptSegment.findMany({
      where: { meetingId, seq: { gt: current.rollingSummarySeq } },
      orderBy: { seq: "asc" },
      take: ROLL_BATCH,
      select: { seq: true, speakerName: true, text: true },
    });
    if (segments.length === 0) return "not-due";
    if (!current.startedById) return "ignored";

    const resolution = await (deps.resolve ?? resolveAi)({
      workspaceId: current.workspaceId,
      userId: current.startedById,
      feature: "meeting",
    });
    if (!resolution.ok) {
      if (!refusalLogged.has(meetingId)) {
        refusalLogged.add(meetingId);
        console.error(
          `[meeting] rolling summary paused for ${meetingId}: ${resolution.reason}`,
        );
        await recordAiRefusal({
          workspaceId: current.workspaceId,
          userId: current.startedById,
          feature: "meeting",
          reason: resolution.reason,
          attempted: resolution.attempted,
        }).catch(() => undefined);
      }
      return "failed";
    }

    const handle = resolution.handle;
    const input = `Previous summary:\n${current.rollingSummary ?? "(none yet)"}\n\nNew captions:\n${segments
      .map((segment) => `${segment.speakerName}: ${segment.text}`)
      .join("\n")}`;
    const response = await withAiCall({ ...resolution.meta, meetingId }, () =>
      handle.client.responses.create({
        model: handle.modelId,
        instructions: ROLL_INSTRUCTIONS,
        input,
        ...reasoningKwargs(handle, "low"),
        max_output_tokens: ROLL_MAX_OUTPUT_TOKENS,
      }),
    );
    const summary = responseText(response).trim().slice(0, ROLL_MAX_CHARS);
    if (summary.length === 0) return "failed";

    const upTo = segments[segments.length - 1]!.seq;
    const written = await prisma.meeting.updateMany({
      where: {
        id: meetingId,
        status: "LIVE",
        rollingSummarySeq: { lt: upTo },
      },
      data: {
        rollingSummary: summary,
        rollingSummarySeq: upTo,
        rollingSummaryAt: new Date(now),
      },
    });
    return written.count === 0 ? "ignored" : "rolled";
  } catch (error) {
    console.error(
      `[meeting] rolling summary failed for ${meetingId}:`,
      error instanceof Error ? error.name : "unknown error",
    );
    return "failed";
  } finally {
    if (locked) await pubClient.del(rollLockKey(meetingId)).catch(() => 0);
  }
}

/**
 * Rolls the summary forward if enough has been said since it last advanced.
 * Called detached after every ingest. Never throws.
 *
 * @param meetingId - The meeting.
 * @param deps - Test seams.
 */
export function maybeRoll(
  meetingId: string,
  deps: RollDeps = {},
): Promise<RollOutcome> {
  return roll(meetingId, { force: false }, deps);
}

/**
 * Returns the summary for "catch me up", regenerating it first when it is
 * stale and captions have arrived since.
 *
 * @param meetingId - The meeting.
 * @param deps - Test seams.
 * @returns The catch-up payload, or null when the meeting does not exist.
 */
export async function getCatchUp(
  meetingId: string,
  deps: RollDeps = {},
): Promise<CatchUpDTO | null> {
  const now = (deps.now ?? Date.now)();
  const read = () =>
    prisma.meeting.findUnique({
      where: { id: meetingId },
      select: {
        status: true,
        startedAt: true,
        endedAt: true,
        rollingSummary: true,
        rollingSummarySeq: true,
        rollingSummaryAt: true,
        summary: true,
      },
    });

  let meeting = await read();
  if (!meeting) return null;

  const stale =
    meeting.status === "LIVE" &&
    (meeting.rollingSummaryAt === null ||
      now - meeting.rollingSummaryAt.getTime() > CATCH_UP_STALE_MS);
  if (stale) {
    const outcome = await roll(meetingId, { force: true }, deps);
    if (outcome === "rolled") meeting = (await read()) ?? meeting;
  }

  const notes = meeting.summary as { summary?: unknown } | null;
  const summary =
    meeting.rollingSummary ??
    (typeof notes?.summary === "string" ? notes.summary : null);
  const end = meeting.endedAt ? meeting.endedAt.getTime() : now;
  return {
    summary,
    upToSeq: meeting.rollingSummarySeq,
    generatedAt: meeting.rollingSummaryAt
      ? meeting.rollingSummaryAt.toISOString()
      : null,
    minutesElapsed: Math.max(
      0,
      Math.floor((end - meeting.startedAt.getTime()) / 60_000),
    ),
  };
}
