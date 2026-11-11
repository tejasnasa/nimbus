/**
 * @module api/lib/meeting/lifecycle
 * @description Ending a meeting, and the timers and boot checks that make sure
 * every meeting does end.
 *
 * Every way a meeting can stop converges on {@link endMeeting}: the Stop
 * button, the agent reporting its own exit, the agent's participant leaving the
 * room, the room closing, the free-budget backstop, and the boot-time sweep for
 * meetings whose room is gone.
 *
 * @important Ending is one conditional transition,
 *            `UPDATE ... SET status = 'ENDED' WHERE status = 'LIVE'`. Only the
 *            caller whose update changed a row runs the side effects (charging
 *            free seconds, broadcasting `meeting:ended`, clearing keys), so
 *            several triggers racing cannot charge twice or announce twice.
 *
 * @important The free-budget backstop is a process-local `setTimeout`. It is a
 *            second line of defence behind the agent's own timer, and losing it
 *            (a restart) is harmless because the charge is computed from the
 *            meeting's timestamps and capped at its budget, never from anything
 *            the agent reports. {@link recoverOrphanedMeetings} re-arms it.
 *
 * @important The meeting's notes are queued from here, a few seconds after the
 *            transition (see `notes`), by the one caller whose update changed
 *            the row. Queuing never blocks or fails ending.
 *
 * @important Free seconds are charged to the user who started the meeting, per
 *            user and not per workspace, as `ceil(endedAt - startedAt)` capped
 *            at the budget handed to the agent. A counter is never lowered.
 */
import { prisma } from "@nimbus/db";
import type { MeetingDTO, MeetingEndReason } from "@nimbus/types";
import type { Server } from "socket.io";
import { readVoiceQuotaLimit } from "../ai/quota";
import { liveRoomNames, removeAgents } from "../livekit/agentRoom";
import { pubClient } from "../redis";
import { captionLanguagesKey } from "./captionLanguages";
import { scheduleNotes } from "./notes";

/** The slice of Socket.IO the lifecycle broadcasts through. */
export type MeetingBroadcaster = Pick<Server, "to">;

/** How long past its budget a free meeting may run before the server steps in. */
export const BUDGET_GRACE_SECONDS = 20;

/** How long the stop flag outlives the request that set it. */
export const STOP_FLAG_TTL_SECONDS = 3600;

/** A meeting row, as far as the lifecycle needs it. */
export type MeetingRow = {
  id: string;
  workspaceId: string;
  roomName: string;
  status: "LIVE" | "ENDED" | "SUMMARIZED" | "FAILED";
  source: "BYOK" | "FREE";
  startedById: string | null;
  startedAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  budgetSeconds: number | null;
  lastSeq: number;
};

/** Redis key of the flag the agent reads as `stop: true`. */
export const stopFlagKey = (meetingId: string) => `meeting:${meetingId}:stop`;

/** Redis key of the last assistant state broadcast for a meeting. */
export const stateKey = (meetingId: string) => `meeting:${meetingId}:state`;

/**
 * Projects a meeting row onto what clients see.
 *
 * @param row - The stored meeting.
 */
export function toMeetingDTO(row: MeetingRow): MeetingDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    status: row.status,
    source: row.source,
    startedById: row.startedById,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    endReason: row.endReason as MeetingEndReason | null,
    budgetSeconds: row.budgetSeconds,
    lastSeq: row.lastSeq,
  };
}

const backstops = new Map<string, NodeJS.Timeout>();

/** Cancels a meeting's budget backstop, if one is armed. */
function disarmBackstop(meetingId: string): void {
  const timer = backstops.get(meetingId);
  if (timer) clearTimeout(timer);
  backstops.delete(meetingId);
}

/**
 * Tells the agent to stop on its next API call.
 *
 * @param meetingId - The meeting.
 */
export async function requestStop(meetingId: string): Promise<void> {
  await pubClient.set(stopFlagKey(meetingId), "1", "EX", STOP_FLAG_TTL_SECONDS);
}

/**
 * Whether the agent has been told to stop.
 *
 * @param meetingId - The meeting.
 */
export async function isStopRequested(meetingId: string): Promise<boolean> {
  return (await pubClient.exists(stopFlagKey(meetingId))) === 1;
}

/** Finishes a user's charge for a free meeting. */
async function chargeFreeSeconds(meeting: {
  startedById: string | null;
  startedAt: Date;
  endedAt: Date;
  budgetSeconds: number | null;
}): Promise<void> {
  if (!meeting.startedById) return;
  const elapsed = Math.ceil(
    (meeting.endedAt.getTime() - meeting.startedAt.getTime()) / 1000,
  );
  const charged = Math.max(
    0,
    meeting.budgetSeconds === null
      ? elapsed
      : Math.min(elapsed, meeting.budgetSeconds),
  );
  if (charged === 0) return;
  const limit = readVoiceQuotaLimit();
  // The counter is capped at the limit but never lowered below where it
  // already stands, so shrinking the allowance later cannot refund anyone.
  await prisma.$executeRaw`
    UPDATE "user"
    SET "freeVoiceSecondsUsed" = LEAST(GREATEST(${limit}::int, "freeVoiceSecondsUsed"), "freeVoiceSecondsUsed" + ${charged}::int)
    WHERE "id" = ${meeting.startedById}
  `;
}

/**
 * Ends a live meeting. Safe to call from any number of triggers at once.
 *
 * @param meetingId - The meeting to end.
 * @param reason - Why it ended.
 * @param deps.io - Broadcaster for `meeting:ended`; omitted in tests that do not listen.
 * @returns `ended: true` for the one caller whose update changed the row, and
 *          `false` for every other (the meeting was not live).
 */
export async function endMeeting(
  meetingId: string,
  reason: MeetingEndReason,
  deps: { io?: MeetingBroadcaster } = {},
): Promise<{ ended: boolean }> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      workspaceId: string;
      source: "BYOK" | "FREE";
      startedById: string | null;
      startedAt: Date;
      endedAt: Date;
      budgetSeconds: number | null;
    }>
  >`
    UPDATE "Meeting"
    SET "status" = 'ENDED', "endedAt" = (now() AT TIME ZONE 'UTC'), "endReason" = ${reason}
    WHERE "id" = ${meetingId} AND "status" = 'LIVE'
    RETURNING "id", "workspaceId", "source", "startedById", "startedAt", "endedAt", "budgetSeconds"
  `;
  const meeting = rows[0];
  if (!meeting) return { ended: false };

  disarmBackstop(meetingId);

  if (meeting.source === "FREE") {
    try {
      await chargeFreeSeconds(meeting);
    } catch (error) {
      console.error(
        `[meeting] could not charge free seconds for ${meetingId}:`,
        error instanceof Error ? error.name : "unknown error",
      );
    }
  }

  deps.io?.to(meeting.workspaceId).emit("meeting:ended", { meetingId, reason });
  await pubClient
    .del(
      stopFlagKey(meetingId),
      stateKey(meetingId),
      captionLanguagesKey(meetingId),
    )
    .catch(() => undefined);
  scheduleNotes(meetingId, { io: deps.io });
  return { ended: true };
}

/**
 * Ends the workspace's live meeting, if it has one.
 *
 * @param workspaceId - The workspace.
 * @param reason - Why it ended.
 * @param deps.io - Broadcaster for `meeting:ended`.
 */
export async function endLiveMeetingOf(
  workspaceId: string,
  reason: MeetingEndReason,
  deps: { io?: MeetingBroadcaster } = {},
): Promise<{ ended: boolean }> {
  const live = await prisma.meeting.findFirst({
    where: { workspaceId, status: "LIVE" },
    select: { id: true },
  });
  if (!live) return { ended: false };
  return endMeeting(live.id, reason, deps);
}

/**
 * Arms the server-side backstop for a free meeting: shortly after the budget
 * should have run out, remove the agent from the room and end the meeting.
 *
 * @param meeting - The meeting; only free meetings with a budget are armed.
 * @param deps.io - Broadcaster passed through to {@link endMeeting}.
 * @param deps.now - The clock in milliseconds. Tests only.
 */
export function armBudgetBackstop(
  meeting: Pick<
    MeetingRow,
    "id" | "roomName" | "source" | "budgetSeconds" | "startedAt"
  >,
  deps: { io?: MeetingBroadcaster; now?: () => number } = {},
): void {
  if (meeting.source !== "FREE" || meeting.budgetSeconds === null) return;
  disarmBackstop(meeting.id);

  const now = (deps.now ?? Date.now)();
  const fireAt =
    meeting.startedAt.getTime() +
    (meeting.budgetSeconds + BUDGET_GRACE_SECONDS) * 1000;
  const timer = setTimeout(
    () => {
      backstops.delete(meeting.id);
      void removeAgents(meeting.roomName)
        .then(() => endMeeting(meeting.id, "budget", { io: deps.io }))
        .catch((error: unknown) => {
          console.error(
            `[meeting] budget backstop failed for ${meeting.id}:`,
            error instanceof Error ? error.name : "unknown error",
          );
        });
    },
    Math.max(0, fireAt - now),
  );
  timer.unref();
  backstops.set(meeting.id, timer);
}

/** Whether a backstop is armed for a meeting. Tests only. */
export function hasBackstop(meetingId: string): boolean {
  return backstops.has(meetingId);
}

/** Cancels every armed backstop. Tests only. */
export function clearBackstops(): void {
  for (const timer of backstops.values()) clearTimeout(timer);
  backstops.clear();
}

/**
 * Boot-time sweep: ends live meetings whose room no longer exists and re-arms
 * the budget backstop for those that remain.
 *
 * A meeting can outlive its room when the API restarts while a call ends, or
 * the media server's webhook for it is lost. Without this the workspace would
 * be stuck with a live meeting no one can stop.
 *
 * @param deps.io - Broadcaster for `meeting:ended`.
 * @returns How many meetings were ended. Zero when the media server could not
 *          be asked, because an unreachable server proves nothing about rooms.
 */
export async function recoverOrphanedMeetings(
  deps: { io?: MeetingBroadcaster } = {},
): Promise<number> {
  const live = await prisma.meeting.findMany({ where: { status: "LIVE" } });
  if (live.length === 0) return 0;

  let rooms: Set<string>;
  try {
    rooms = await liveRoomNames();
  } catch (error) {
    console.error(
      "[meeting] could not list rooms to recover live meetings:",
      error instanceof Error ? error.name : "unknown error",
    );
    return 0;
  }

  let ended = 0;
  for (const meeting of live) {
    if (!rooms.has(meeting.roomName)) {
      const result = await endMeeting(meeting.id, "orphaned", deps);
      if (result.ended) ended += 1;
    } else {
      armBudgetBackstop(meeting, deps);
    }
  }
  return ended;
}
