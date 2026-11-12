/**
 * @module api/lib/meeting/segments
 * @description Storing the transcript the agent posts, broadcasting each new
 * caption to the workspace and queueing it for translation.
 *
 * @important Ingestion is idempotent on `(meetingId, seq)`. The agent retries a
 *            batch after any network error, so a replay inserts nothing and, in
 *            particular, broadcasts nothing: only rows this call inserted are
 *            announced, in sequence order. `Meeting.lastSeq` only moves forward.
 *
 * @important New captions are handed to translation after they are stored and
 *            announced, detached, so a slow or failing model call never delays
 *            the agent's response or loses a caption.
 *
 * @important The rolling summary is advanced the same way: after the captions
 *            are stored, detached, and never allowed to fail the ingest.
 *
 * @important The assistant's own replies are stored here too, under a sequence
 *            number the agent reserved for them, so they can never collide
 *            with a caption the agent posts later. They carry no speaker id,
 *            the name {@link ASSISTANT_SPEAKER_NAME} and `fromAssistant`.
 *
 * @important A speaker id is trusted only if that user is a current member of
 *            the meeting's workspace. Anything else is stored with a null
 *            speaker and the name as spoken, so a stale or forged id cannot
 *            attach a caption to someone outside the workspace.
 */
import { prisma } from "@nimbus/db";
import type { SegmentDTO, SegmentIn } from "@nimbus/types";
import type { MeetingBroadcaster } from "./lifecycle";
import { maybeRoll } from "./rollingSummary";
import { translateSegments } from "./translation";

/** The name the assistant's replies are captioned under. */
export const ASSISTANT_SPEAKER_NAME = "Nimbus";

/** What ingestion did with a batch. */
export type IngestResult = {
  /** Every sequence number in the batch is stored once this returns. */
  accepted: number[];
  /** The captions that were new, in sequence order. */
  inserted: SegmentDTO[];
};

type StoredSegment = {
  id: string;
  meetingId: string;
  seq: number;
  speakerUserId: string | null;
  speakerName: string;
  text: string;
  startMs: number;
  endMs: number;
  language: string | null;
  addressed?: boolean;
  fromAssistant?: boolean;
};

/**
 * Projects a stored segment onto what clients see.
 *
 * @param row - The stored segment.
 */
export function toSegmentDTO(row: StoredSegment): SegmentDTO {
  return {
    id: row.id,
    meetingId: row.meetingId,
    seq: row.seq,
    speakerUserId: row.speakerUserId,
    speakerName: row.speakerName,
    text: row.text,
    startMs: row.startMs,
    endMs: row.endMs,
    language: row.language,
    addressed: row.addressed ?? false,
    fromAssistant: row.fromAssistant ?? false,
  };
}

/**
 * Stores a batch of segments and announces the new ones.
 *
 * @param meeting - The meeting the batch belongs to.
 * @param segments - The batch, already validated.
 * @param deps.io - Broadcaster for `meeting:segment`.
 * @returns The accepted sequence numbers and the captions that were new.
 */
export async function ingestSegments(
  meeting: { id: string; workspaceId: string },
  segments: readonly SegmentIn[],
  deps: { io?: MeetingBroadcaster } = {},
): Promise<IngestResult> {
  const speakerIds = [
    ...new Set(
      segments
        .map((segment) => segment.speakerUserId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const members =
    speakerIds.length === 0
      ? []
      : await prisma.workspaceMember.findMany({
          where: {
            workspaceId: meeting.workspaceId,
            userId: { in: speakerIds },
          },
          select: { userId: true },
        });
  const memberIds = new Set(members.map((member) => member.userId));

  const created = await prisma.transcriptSegment.createManyAndReturn({
    data: segments.map((segment) => ({
      meetingId: meeting.id,
      seq: segment.seq,
      speakerUserId:
        segment.speakerUserId && memberIds.has(segment.speakerUserId)
          ? segment.speakerUserId
          : null,
      speakerName: segment.speakerName,
      text: segment.text,
      startMs: segment.startMs,
      endMs: Math.max(segment.endMs, segment.startMs),
      language: segment.language ?? null,
      addressed: segment.addressed ?? false,
    })),
    skipDuplicates: true,
  });

  const highest = Math.max(...segments.map((segment) => segment.seq));
  await prisma.$executeRaw`
    UPDATE "Meeting"
    SET "lastSeq" = GREATEST("lastSeq", ${highest}::int)
    WHERE "id" = ${meeting.id}
  `;

  const inserted = created.map(toSegmentDTO).sort((a, b) => a.seq - b.seq);
  for (const segment of inserted) {
    deps.io
      ?.to(meeting.workspaceId)
      .emit("meeting:segment", { meetingId: meeting.id, segment });
  }

  // Detached: translation is never allowed to slow or fail the ingest response.
  void translateSegments(meeting, inserted, { io: deps.io });
  if (inserted.length > 0) void maybeRoll(meeting.id);

  return {
    accepted: [...new Set(segments.map((segment) => segment.seq))].sort(
      (a, b) => a - b,
    ),
    inserted,
  };
}

/**
 * Stores the assistant's spoken reply as a caption and announces it, exactly
 * like a caption the agent posted: idempotent on the sequence number, moving
 * `lastSeq` forward, then translated and folded into the rolling summary.
 *
 * @param meeting - The meeting the reply belongs to.
 * @param reply.seq - The sequence number the agent reserved for it.
 * @param reply.text - What the assistant said.
 * @param reply.startMs - When it started speaking, from the meeting's start.
 * @param reply.endMs - When it is expected to finish.
 * @param deps.io - Broadcaster for `meeting:segment`.
 * @returns The stored caption, or null when that number was already taken.
 */
export async function storeAssistantReply(
  meeting: { id: string; workspaceId: string },
  reply: { seq: number; text: string; startMs: number; endMs: number },
  deps: { io?: MeetingBroadcaster } = {},
): Promise<SegmentDTO | null> {
  const created = await prisma.transcriptSegment.createManyAndReturn({
    data: [
      {
        meetingId: meeting.id,
        seq: reply.seq,
        speakerUserId: null,
        speakerName: ASSISTANT_SPEAKER_NAME,
        text: reply.text,
        startMs: Math.max(0, Math.round(reply.startMs)),
        endMs: Math.max(Math.round(reply.endMs), Math.round(reply.startMs), 0),
        fromAssistant: true,
      },
    ],
    skipDuplicates: true,
  });
  await prisma.$executeRaw`
    UPDATE "Meeting"
    SET "lastSeq" = GREATEST("lastSeq", ${reply.seq}::int)
    WHERE "id" = ${meeting.id}
  `;
  const row = created[0];
  if (!row) return null;

  const segment = toSegmentDTO(row);
  deps.io
    ?.to(meeting.workspaceId)
    .emit("meeting:segment", { meetingId: meeting.id, segment });
  void translateSegments(meeting, [segment], { io: deps.io });
  void maybeRoll(meeting.id);
  return segment;
}
