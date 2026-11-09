/**
 * @module api/controllers/meeting
 * @description The REST surface of the in-call assistant: starting it, stopping
 * it, finding the workspace's live meeting, listing past meetings and paging a
 * transcript.
 *
 * Starting walks a fixed sequence: membership, an existing live meeting
 * (returned as-is, which makes the call idempotent), a call with people in it,
 * the voice entitlement, the free allowance, then the meeting row, the ticket
 * and the agent dispatch.
 *
 * @important One workspace has at most one live meeting. The check above is a
 *            fast path; the guarantee is the partial unique index on
 *            `Meeting(workspaceId) WHERE status = 'LIVE'`. When five starts race,
 *            exactly one insert wins, and every loser re-reads and returns the
 *            winner without dispatching a second agent.
 *
 * @important This module imports `voiceAvailability`, never `voiceEntitlements`:
 *            deciding whether the assistant may start never touches a key. The
 *            plaintext key is produced later, when the agent redeems its ticket.
 *
 * @important The free-budget backstop armed on start is process-local. See
 *            `lib/meeting/lifecycle` for why losing it is harmless.
 */
import { prisma } from "@nimbus/db";
import {
  assistantStartSchema,
  liveMeetingQuerySchema,
  meetingListQuerySchema,
  segmentsQuerySchema,
  ServerResponse,
  type AssistantRefusalDTO,
  type LiveMeetingDTO,
  type MeetingDTO,
  type MeetingListDTO,
  type SegmentPageDTO,
} from "@nimbus/types";
import { readVoiceQuotaState } from "../lib/ai/quota";
import {
  planVoice,
  voiceRefusal,
  type VoiceRefusal,
  type VoiceRefusalReason,
} from "../lib/ai/voiceAvailability";
import { countHumans, removeAgents } from "../lib/livekit/agentRoom";
import { getAgentDispatchClient } from "../lib/livekit/client";
import { AGENT_NAME, roomNameFor } from "../lib/livekit/rooms";
import {
  armBudgetBackstop,
  endMeeting,
  requestStop,
  toMeetingDTO,
  type MeetingBroadcaster,
} from "../lib/meeting/lifecycle";
import { toSegmentDTO } from "../lib/meeting/segments";
import { issueTicket } from "../lib/meeting/tickets";
import { requireWorkspaceRole } from "../lib/workspaceAccess";

/** The least free time worth starting an assistant for, in seconds. */
export const MIN_FREE_START_SECONDS = 15;

/** How long the agent has to leave on its own after a stop, in milliseconds. */
export const STOP_REMOVAL_DELAY_MS = 5000;

const CTA: Record<VoiceRefusalReason, AssistantRefusalDTO["cta"]> = {
  "assistant-disabled": "manage-ai",
  "no-voice-key": "add-key",
  "free-voice-exhausted": "add-key",
  "spend-cap-reached": "manage-ai",
};

/** A 403 carrying the curated reason and which settings surface fixes it. */
function refusalResponse(refusal: VoiceRefusal) {
  return new ServerResponse<AssistantRefusalDTO>(
    false,
    refusal.message,
    { reason: refusal.reason, cta: CTA[refusal.reason] },
    403,
  );
}

/** Reads the workspace's live meeting. */
function findLive(workspaceId: string) {
  return prisma.meeting.findFirst({ where: { workspaceId, status: "LIVE" } });
}

/**
 * Starts the assistant in a workspace's call.
 *
 * @param user - The authenticated user, who becomes the meeting's starter and,
 *               on the free tier, who pays for it.
 * @param body - The raw request body.
 * @param deps.io - Broadcaster for `meeting:started`.
 * @returns 201 with the meeting; 200 with the existing one when already
 *          running; 404 for a non-member; 409 when nobody is on the call; 403
 *          with the refusal reason; 502 when the agent cannot be dispatched.
 */
export async function startAssistant(
  user: { id: string },
  body: unknown,
  deps: { io?: MeetingBroadcaster } = {},
) {
  const parsed = assistantStartSchema.safeParse(body);
  if (!parsed.success)
    return ServerResponse.badRequest("workspaceId is required");
  const { workspaceId } = parsed.data;

  try {
    const access = await requireWorkspaceRole(user.id, workspaceId);
    if (!access.ok) return access.response;

    const existing = await findLive(workspaceId);
    if (existing) {
      return ServerResponse.ok<MeetingDTO>(
        toMeetingDTO(existing),
        "Nimbus is already in the call",
      );
    }

    const roomName = roomNameFor(workspaceId);
    let humans: number;
    try {
      humans = await countHumans(roomName);
    } catch (error) {
      console.error(
        "[meeting] could not read the call:",
        error instanceof Error ? error.name : "unknown error",
      );
      return ServerResponse.badGateway("Voice is unavailable right now");
    }
    if (humans === 0) {
      return ServerResponse.conflict("Join the call before starting Nimbus");
    }

    const planned = await planVoice({ workspaceId, userId: user.id });
    if (!planned.ok) return refusalResponse(planned);

    let budgetSeconds: number | null = null;
    if (planned.plan.source === "free") {
      const quota = await readVoiceQuotaState(user.id);
      if (quota.remaining < MIN_FREE_START_SECONDS) {
        return refusalResponse(voiceRefusal("free-voice-exhausted"));
      }
      budgetSeconds = quota.remaining;
    }

    let meeting;
    try {
      meeting = await prisma.meeting.create({
        data: {
          workspaceId,
          roomName,
          startedById: user.id,
          source: planned.plan.source === "free" ? "FREE" : "BYOK",
          budgetSeconds,
        },
      });
    } catch (error) {
      // Losing the race on the one-live-meeting index: return the winner.
      const winner = await findLive(workspaceId);
      if (winner) {
        return ServerResponse.ok<MeetingDTO>(
          toMeetingDTO(winner),
          "Nimbus is already in the call",
        );
      }
      throw error;
    }

    try {
      const ticket = await issueTicket(meeting.id);
      await getAgentDispatchClient().createDispatch(roomName, AGENT_NAME, {
        metadata: JSON.stringify({ ticket }),
      });
    } catch (error) {
      console.error(
        `[meeting] could not dispatch the agent for ${meeting.id}:`,
        error instanceof Error ? error.name : "unknown error",
      );
      await prisma.meeting.updateMany({
        where: { id: meeting.id, status: "LIVE" },
        data: {
          status: "FAILED",
          endedAt: new Date(),
          endReason: "dispatch-failed",
        },
      });
      return ServerResponse.badGateway(
        "Nimbus couldn't join the call. Please try again.",
      );
    }

    const dto = toMeetingDTO(meeting);
    deps.io?.to(workspaceId).emit("meeting:started", dto);
    armBudgetBackstop(meeting, deps);
    return ServerResponse.created<MeetingDTO>(
      dto,
      "Nimbus is joining the call",
    );
  } catch (error) {
    console.error(
      "[meeting] could not start the assistant:",
      error instanceof Error ? error.name : "unknown error",
    );
    return ServerResponse.internalError(null, "Could not start Nimbus");
  }
}

/**
 * Stops the assistant.
 *
 * Sets the flag the agent reads on its next API response, ends the meeting, and
 * schedules the agent's removal from the room in case it does not leave itself.
 *
 * @param userId - The authenticated user.
 * @param meetingId - The meeting to stop.
 * @param deps.io - Broadcaster for `meeting:ended`.
 * @returns The meeting; 404 for a non-member of its workspace.
 */
export async function stopAssistant(
  userId: string,
  meetingId: string,
  deps: { io?: MeetingBroadcaster } = {},
) {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
    });
    if (!meeting) return ServerResponse.notFound("Meeting not found");
    const access = await requireWorkspaceRole(userId, meeting.workspaceId);
    if (!access.ok) return ServerResponse.notFound("Meeting not found");

    if (meeting.status === "LIVE") {
      await requestStop(meeting.id);
      const removal = setTimeout(() => {
        void removeAgents(meeting.roomName);
      }, STOP_REMOVAL_DELAY_MS);
      removal.unref();
      await endMeeting(meeting.id, "stopped", deps);
    }

    const current = await prisma.meeting.findUnique({
      where: { id: meetingId },
    });
    return ServerResponse.ok<MeetingDTO>(
      toMeetingDTO(current ?? meeting),
      "Nimbus stopped",
    );
  } catch (error) {
    console.error(
      "[meeting] could not stop the assistant:",
      error instanceof Error ? error.name : "unknown error",
    );
    return ServerResponse.internalError(null, "Could not stop Nimbus");
  }
}

/**
 * Reads the workspace's live meeting, if it has one.
 *
 * @param userId - The authenticated user.
 * @param query - The raw query string values.
 * @returns `{ meeting }` with `null` when none is live; 404 for a non-member.
 */
export async function getLiveMeeting(userId: string, query: unknown) {
  const parsed = liveMeetingQuerySchema.safeParse(query);
  if (!parsed.success)
    return ServerResponse.badRequest("workspaceId is required");

  try {
    const access = await requireWorkspaceRole(userId, parsed.data.workspaceId);
    if (!access.ok) return access.response;

    const live = await findLive(parsed.data.workspaceId);
    return ServerResponse.ok<LiveMeetingDTO>({
      meeting: live ? toMeetingDTO(live) : null,
    });
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}

/**
 * Lists a workspace's meetings, newest first, for the transcript history.
 *
 * @param userId - The authenticated user.
 * @param query - The raw query string values (`workspaceId`, `cursor`, `limit`).
 * @returns A page of meetings with who started each and how many segments it
 *          holds; 404 for a non-member.
 */
export async function listMeetings(userId: string, query: unknown) {
  const parsed = meetingListQuerySchema.safeParse(query);
  if (!parsed.success) return ServerResponse.badRequest("Invalid query");

  try {
    const { workspaceId, cursor, limit } = parsed.data;
    const access = await requireWorkspaceRole(userId, workspaceId);
    if (!access.ok) return access.response;

    // The cursor is a meeting id; scoping it to the workspace keeps a foreign
    // id from paging another workspace's history.
    const anchor = cursor
      ? await prisma.meeting.findFirst({
          where: { id: cursor, workspaceId },
          select: { id: true },
        })
      : null;
    if (cursor && !anchor) return ServerResponse.badRequest("Invalid cursor");

    const rows = await prisma.meeting.findMany({
      where: { workspaceId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(anchor ? { cursor: { id: anchor.id }, skip: 1 } : {}),
      include: {
        startedBy: { select: { name: true } },
        _count: { select: { segments: true } },
      },
    });
    const page = rows.slice(0, limit);
    return ServerResponse.ok<MeetingListDTO>({
      meetings: page.map((row) => ({
        ...toMeetingDTO(row),
        startedByName: row.startedBy?.name ?? null,
        segmentCount: row._count.segments,
      })),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    });
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}

/**
 * Pages a meeting's transcript.
 *
 * @param userId - The authenticated user.
 * @param meetingId - The meeting.
 * @param query - The raw query string values (`afterSeq`, `limit`).
 * @returns Segments after `afterSeq` in sequence order; 404 for a non-member.
 */
export async function listSegments(
  userId: string,
  meetingId: string,
  query: unknown,
) {
  const parsed = segmentsQuerySchema.safeParse(query);
  if (!parsed.success) return ServerResponse.badRequest("Invalid paging");

  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { workspaceId: true },
    });
    if (!meeting) return ServerResponse.notFound("Meeting not found");
    const access = await requireWorkspaceRole(userId, meeting.workspaceId);
    if (!access.ok) return ServerResponse.notFound("Meeting not found");

    const { afterSeq, limit } = parsed.data;
    const rows = await prisma.transcriptSegment.findMany({
      where: { meetingId, seq: { gt: afterSeq } },
      orderBy: { seq: "asc" },
      take: limit + 1,
    });
    return ServerResponse.ok<SegmentPageDTO>({
      segments: rows.slice(0, limit).map(toSegmentDTO),
      hasMore: rows.length > limit,
    });
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}
