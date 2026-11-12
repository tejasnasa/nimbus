/**
 * @module api/controllers/meeting
 * @description The REST surface of the in-call assistant: starting it, stopping
 * it, finding the workspace's live meeting, listing past meetings, reading one
 * with its notes, paging a transcript, "catch me up", keyword search, drawing a
 * meeting's discussion and deleting a meeting.
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
 * @important Every read and write by meeting id checks the caller's membership of
 *            the meeting's workspace first and answers 404 for a non-member, so
 *            a meeting id from another workspace is indistinguishable from one
 *            that does not exist.
 *
 * @important The free-budget backstop armed on start is process-local. See
 *            `lib/meeting/lifecycle` for why losing it is harmless.
 */
import { prisma } from "@nimbus/db";
import {
  assistantStartSchema,
  liveMeetingQuerySchema,
  meetingListQuerySchema,
  MeetingSummarySchema,
  meetingSearchQuerySchema,
  segmentsQuerySchema,
  ServerResponse,
  type AssistantRefusalDTO,
  type CatchUpDTO,
  type LiveMeetingDTO,
  type MeetingDetailDTO,
  type MeetingDTO,
  type MeetingListDTO,
  type MeetingParticipantDTO,
  type SegmentPageDTO,
  type SegmentSearchDTO,
} from "@nimbus/types";
import { isCaptionLanguage } from "@nimbus/utils";
import { resolveAi } from "../lib/ai/entitlements";
import { claimFreeDocGeneration, readVoiceQuotaState } from "../lib/ai/quota";
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
  actionItemInclude,
  actionItemsForMeeting,
  broadcastActionItems,
  toActionItemDTOs,
} from "../lib/meeting/actionItems";
import { buildDiagramPrompt, runMeetingDiagram } from "../lib/meeting/diagram";
import {
  armBudgetBackstop,
  endMeeting,
  requestStop,
  toMeetingDTO,
  type MeetingBroadcaster,
} from "../lib/meeting/lifecycle";
import { getCatchUp } from "../lib/meeting/rollingSummary";
import { searchSegments } from "../lib/meeting/search";
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
 * @returns A page of meetings with who started each, how many segments it
 *          holds, its title and its notes document; 404 for a non-member.
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
        title: row.title,
        notesDocumentId: row.notesDocumentId,
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
 * @param query - The raw query string values (`afterSeq`, `limit`, `language`).
 * @returns Segments after `afterSeq` in sequence order, each with its stored
 *          translation into `language` when one was asked for (null where
 *          none exists); 400 for an unsupported language; 404 for a non-member.
 */
export async function listSegments(
  userId: string,
  meetingId: string,
  query: unknown,
) {
  const parsed = segmentsQuerySchema.safeParse(query);
  if (!parsed.success) return ServerResponse.badRequest("Invalid paging");
  if (
    parsed.data.language !== undefined &&
    !isCaptionLanguage(parsed.data.language)
  ) {
    return ServerResponse.badRequest("Unsupported caption language");
  }

  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { workspaceId: true },
    });
    if (!meeting) return ServerResponse.notFound("Meeting not found");
    const access = await requireWorkspaceRole(userId, meeting.workspaceId);
    if (!access.ok) return ServerResponse.notFound("Meeting not found");

    const { afterSeq, limit, language } = parsed.data;
    const rows = await prisma.transcriptSegment.findMany({
      where: { meetingId, seq: { gt: afterSeq } },
      orderBy: { seq: "asc" },
      take: limit + 1,
      include: {
        translations: language ? { where: { language } } : false,
      },
    });
    return ServerResponse.ok<SegmentPageDTO>({
      segments: rows.slice(0, limit).map((row) => {
        const segment = toSegmentDTO(row);
        if (!language) return segment;
        return { ...segment, translation: row.translations?.[0]?.text ?? null };
      }),
      hasMore: rows.length > limit,
    });
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}

/** Reads a meeting and checks the caller may see it; a non-member gets the 404. */
async function readAccessibleMeeting(userId: string, meetingId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
  });
  if (!meeting) return { ok: false as const, response: notFoundMeeting() };
  const access = await requireWorkspaceRole(userId, meeting.workspaceId);
  if (!access.ok) return { ok: false as const, response: notFoundMeeting() };
  return { ok: true as const, meeting, role: access.role };
}

const notFoundMeeting = () => ServerResponse.notFound("Meeting not found");

/**
 * Reads one meeting with its notes: summary, decisions, action items and who
 * spoke.
 *
 * @param userId - The authenticated user.
 * @param meetingId - The meeting.
 * @returns The detail; 404 for a missing meeting or a non-member.
 */
export async function getMeetingDetail(userId: string, meetingId: string) {
  try {
    const found = await readAccessibleMeeting(userId, meetingId);
    if (!found.ok) return found.response;
    const { meeting } = found;

    const [starter, segmentCount, decisionRows, actionItems, speakers] =
      await Promise.all([
        meeting.startedById
          ? prisma.user.findUnique({
              where: { id: meeting.startedById },
              select: { name: true },
            })
          : null,
        prisma.transcriptSegment.count({ where: { meetingId } }),
        prisma.decision.findMany({
          where: { meetingId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        actionItemsForMeeting(meetingId),
        // The assistant's own replies are captions too, but it is not a participant.
        prisma.transcriptSegment.findMany({
          where: { meetingId, fromAssistant: false },
          orderBy: { seq: "asc" },
          distinct: ["speakerUserId", "speakerName"],
          select: { speakerUserId: true, speakerName: true },
        }),
      ]);

    const cited = decisionRows
      .map((row) => row.sourceSegmentId)
      .filter((id): id is string => id !== null);
    const seqs =
      cited.length === 0
        ? []
        : await prisma.transcriptSegment.findMany({
            where: { id: { in: cited } },
            select: { id: true, seq: true },
          });
    const seqById = new Map(seqs.map((row) => [row.id, row.seq]));

    const seenUsers = new Set<string>();
    const seenNames = new Set<string>();
    const participants: MeetingParticipantDTO[] = [];
    for (const speaker of speakers) {
      // One entry per person: by user id, and by name for the unmatched ones.
      if (speaker.speakerUserId) {
        if (seenUsers.has(speaker.speakerUserId)) continue;
        seenUsers.add(speaker.speakerUserId);
      } else if (seenNames.has(speaker.speakerName)) {
        continue;
      }
      seenNames.add(speaker.speakerName);
      participants.push({
        userId: speaker.speakerUserId,
        name: speaker.speakerName,
      });
    }

    const parsed = MeetingSummarySchema.safeParse(meeting.summary);
    return ServerResponse.ok<MeetingDetailDTO>({
      ...toMeetingDTO(meeting),
      title: meeting.title,
      startedByName: starter?.name ?? null,
      segmentCount,
      summary: parsed.success ? parsed.data : null,
      decisions: decisionRows.map((row) => ({
        id: row.id,
        meetingId: row.meetingId,
        text: row.text,
        sourceSeq: row.sourceSegmentId
          ? (seqById.get(row.sourceSegmentId) ?? null)
          : null,
      })),
      actionItems,
      participants,
      notesDocumentId: meeting.notesDocumentId,
      failureReason: meeting.failureReason,
    });
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}

/**
 * Returns the rolling summary for "catch me up", regenerating it first when it
 * is stale and captions have arrived since.
 *
 * @param userId - The authenticated user.
 * @param meetingId - The meeting.
 * @returns The catch-up payload; 404 for a missing meeting or a non-member.
 */
export async function getMeetingCatchUp(userId: string, meetingId: string) {
  try {
    const found = await readAccessibleMeeting(userId, meetingId);
    if (!found.ok) return found.response;
    const catchUp = await getCatchUp(meetingId);
    if (!catchUp) return notFoundMeeting();
    return ServerResponse.ok<CatchUpDTO>(catchUp);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}

/**
 * Searches the workspace's transcripts by keyword.
 *
 * @param userId - The authenticated user.
 * @param query - The raw query string values (`workspaceId`, `q`, `sinceDays`, `limit`).
 * @returns The hits; 404 for a non-member.
 */
export async function searchMeetingTranscripts(userId: string, query: unknown) {
  const parsed = meetingSearchQuerySchema.safeParse(query);
  if (!parsed.success) return ServerResponse.badRequest("Invalid query");
  try {
    const { workspaceId, q, sinceDays, limit } = parsed.data;
    const access = await requireWorkspaceRole(userId, workspaceId);
    if (!access.ok) return access.response;
    const hits = await searchSegments(workspaceId, q, { sinceDays, limit });
    return ServerResponse.ok<SegmentSearchDTO>({ hits });
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}

/**
 * Deletes a meeting with its transcript, translations and decisions.
 *
 * Its action items are kept with no meeting, and its notes document stays: it
 * is an ordinary workspace document by now.
 *
 * @param userId - The authenticated user.
 * @param meetingId - The meeting.
 * @param deps.io - Broadcaster for `meeting:deleted` and the detached items.
 * @returns 200 once deleted; 403 unless the caller is an admin or the one who
 *          started it; 404 for a missing meeting or a non-member; 409 while
 *          it is live.
 */
export async function deleteMeeting(
  userId: string,
  meetingId: string,
  deps: { io?: MeetingBroadcaster } = {},
) {
  try {
    const found = await readAccessibleMeeting(userId, meetingId);
    if (!found.ok) return found.response;
    const { meeting, role } = found;

    if (role === "MEMBER" && meeting.startedById !== userId) {
      return ServerResponse.forbidden(
        "Only an admin or whoever started the meeting can delete it",
      );
    }
    if (meeting.status === "LIVE") {
      return ServerResponse.conflict("End the meeting before deleting it");
    }

    const kept = await prisma.actionItem.findMany({
      where: { meetingId },
      select: { id: true },
    });
    // Conditional on not being live: a meeting cannot return to LIVE, so this
    // only guards the window between the check above and the delete.
    const deleted = await prisma.meeting.deleteMany({
      where: { id: meetingId, status: { not: "LIVE" } },
    });
    if (deleted.count === 0) return notFoundMeeting();

    deps.io?.to(meeting.workspaceId).emit("meeting:deleted", { meetingId });
    if (kept.length > 0 && deps.io) {
      const rows = await prisma.actionItem.findMany({
        where: { id: { in: kept.map((item) => item.id) } },
        include: actionItemInclude,
      });
      await broadcastActionItems(deps.io, {
        workspaceId: meeting.workspaceId,
        meetingId: null,
        changed: await toActionItemDTOs(rows),
      });
    }
    return ServerResponse.ok<{ meetingId: string }>(
      { meetingId },
      "Meeting deleted",
    );
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}

/**
 * Starts drawing a meeting's discussion on a new canvas document.
 *
 * Progress streams to the workspace as `doc:ai:start`, `doc:ai:thinking` and
 * `doc:ai:complete` or `doc:ai:error`; the response only says it began.
 *
 * @param userId - The authenticated user, whose free allowance is used if the
 *                 operator's free tier would pay.
 * @param meetingId - The meeting; it must have notes.
 * @param deps.io - Broadcaster for the `doc:ai:*` events.
 * @returns 202 when generation started; 403 with the refusal when the
 *          workspace cannot generate canvases; 404 for a missing meeting or a
 *          non-member; 409 when the meeting has no notes yet.
 */
export async function startMeetingDiagram(
  userId: string,
  meetingId: string,
  deps: { io?: MeetingBroadcaster } = {},
) {
  try {
    const found = await readAccessibleMeeting(userId, meetingId);
    if (!found.ok) return found.response;
    const { meeting } = found;

    const parsed = MeetingSummarySchema.safeParse(meeting.summary);
    if (!parsed.success) {
      return ServerResponse.conflict("The notes for this meeting aren't ready");
    }

    const resolution = await resolveAi({
      workspaceId: meeting.workspaceId,
      userId,
      feature: "canvas",
    });
    if (!resolution.ok) {
      return new ServerResponse(
        false,
        resolution.message,
        { reason: resolution.reason, cta: resolution.cta },
        403,
      );
    }

    let claimed = false;
    if (resolution.source === "free") {
      const claim = await claimFreeDocGeneration(userId);
      if (!claim.granted) {
        return new ServerResponse(
          false,
          "You've used all your free document generations. Add your own API key to keep creating.",
          { reason: "free-tier-exhausted", cta: "add-key" },
          403,
        );
      }
      claimed = true;
    }

    const { label, prompt } = buildDiagramPrompt(parsed.data);
    void runMeetingDiagram({
      io: deps.io,
      workspaceId: meeting.workspaceId,
      userId,
      label,
      prompt,
      handle: resolution.handle,
      meta: resolution.meta,
      claimed,
    });
    return new ServerResponse<{ started: true; label: string }>(
      true,
      "Drawing the discussion",
      { started: true, label },
      202,
    );
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}
