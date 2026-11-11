/**
 * @module api/lib/meeting/actionItems
 * @description Projecting action items onto what clients see, and telling the
 * workspace when they change.
 *
 * @important Every change to an action item, from any source, goes through
 *            {@link broadcastActionItems}, so each open view hears about it as
 *            one `meeting:action-items` event. The payload's two shapes (a
 *            meeting's complete set, or a single changed item) are described on
 *            `ActionItemsChangedDTO`; keep both in step with that type.
 */
import { prisma } from "@nimbus/db";
import type { ActionItemDTO } from "@nimbus/types";
import type { MeetingBroadcaster } from "./lifecycle";

/** What is read alongside an action item to project it. */
export const actionItemInclude = {
  owner: { select: { name: true } },
  meeting: { select: { title: true } },
} as const;

/** An action item row with the relations {@link actionItemInclude} reads. */
export type ActionItemRow = {
  id: string;
  workspaceId: string;
  meetingId: string | null;
  text: string;
  ownerUserId: string | null;
  ownerName: string | null;
  dueDate: Date | null;
  status: "OPEN" | "DONE";
  sourceSegmentId: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  owner: { name: string } | null;
  meeting: { title: string | null } | null;
};

/**
 * Projects action item rows onto their DTOs, looking up the sequence numbers
 * of the segments they cite in one query.
 *
 * @param rows - Rows read with {@link actionItemInclude}.
 */
export async function toActionItemDTOs(
  rows: readonly ActionItemRow[],
): Promise<ActionItemDTO[]> {
  const segmentIds = [
    ...new Set(
      rows
        .map((row) => row.sourceSegmentId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const segments =
    segmentIds.length === 0
      ? []
      : await prisma.transcriptSegment.findMany({
          where: { id: { in: segmentIds } },
          select: { id: true, seq: true },
        });
  const seqById = new Map(segments.map((segment) => [segment.id, segment.seq]));

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    meetingId: row.meetingId,
    meetingTitle: row.meeting?.title ?? null,
    text: row.text,
    ownerUserId: row.ownerUserId,
    ownerName: row.owner?.name ?? row.ownerName,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    status: row.status,
    sourceSeq: row.sourceSegmentId
      ? (seqById.get(row.sourceSegmentId) ?? null)
      : null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  }));
}

/**
 * Reads a meeting's action items in the order they were created.
 *
 * @param meetingId - The meeting.
 */
export async function actionItemsForMeeting(
  meetingId: string,
): Promise<ActionItemDTO[]> {
  const rows = await prisma.actionItem.findMany({
    where: { meetingId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: actionItemInclude,
  });
  return toActionItemDTOs(rows);
}

/**
 * Announces a change to action items to the workspace.
 *
 * With a `meetingId` the event carries that meeting's complete current set;
 * without one it carries just `changed`.
 *
 * @param io - Broadcaster; nothing happens without one.
 * @param change.workspaceId - The workspace room.
 * @param change.meetingId - The meeting the items belong to, if any.
 * @param change.changed - The changed item, for an item without a meeting.
 * @param change.removedIds - Ids of items that were deleted.
 */
export async function broadcastActionItems(
  io: MeetingBroadcaster | undefined,
  change: {
    workspaceId: string;
    meetingId: string | null;
    changed?: ActionItemDTO[];
    removedIds?: string[];
  },
): Promise<void> {
  if (!io) return;
  const items = change.meetingId
    ? await actionItemsForMeeting(change.meetingId)
    : (change.changed ?? []);
  io.to(change.workspaceId).emit("meeting:action-items", {
    meetingId: change.meetingId,
    items,
    removedIds: change.removedIds ?? [],
  });
}
