/**
 * @module api/lib/meeting/actionItems
 * @description Projecting action items onto what clients see, adding,
 * changing and deleting them under the workspace's rules, and telling the
 * workspace when they change.
 *
 * {@link changeActionItem} and {@link removeActionItem} are the one path for
 * editing and deleting an item, shared by the REST controller and the
 * assistant's tools, so both apply the same membership and permission rules.
 * {@link addActionItem} is the REST path for adding one by hand; the
 * assistant's tool adds items from a spoken owner name instead.
 *
 * @important Every change to an action item, from any source, goes through
 *            {@link broadcastActionItems}, so each open view hears about it as
 *            one `meeting:action-items` event. The payload's two shapes (a
 *            meeting's complete set, or a single changed item) are described on
 *            `ActionItemsChangedDTO`; keep both in step with that type.
 */
import { prisma } from "@nimbus/db";
import type { ActionItemDTO } from "@nimbus/types";
import { requireWorkspaceRole } from "../workspaceAccess";
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

/** A change to an action item; an absent field is left as it is. */
export type ActionItemChange = {
  status?: "OPEN" | "DONE";
  /** A member's user id, or null to clear the owner. */
  ownerUserId?: string | null;
  /** `YYYY-MM-DD`, or null to clear the due date. */
  dueDate?: string | null;
  text?: string;
};

/** The result of changing or deleting an item: the value, or why not. */
export type ActionItemOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; message: string };

/** Who is acting, where, and with what to broadcast. */
export type ActionItemActor = {
  userId: string;
  io?: MeetingBroadcaster;
  /**
   * Confines the action to one workspace: an item elsewhere reads as missing,
   * even when the user is a member there too. The assistant's tools set it.
   */
  workspaceId?: string;
};

const missing = {
  ok: false,
  status: 404,
  message: "Action item not found",
} as const;

/** Whether a user is a current member of a workspace. */
async function isMember(userId: string, workspaceId: string) {
  const row = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { userId: true },
  });
  return row !== null;
}

const notMemberOwner = {
  ok: false,
  status: 400,
  message: "The owner must be a member of this workspace",
} as const;

/** A new action item added by hand. */
export type NewActionItem = {
  workspaceId: string;
  meetingId?: string | null;
  text: string;
  ownerUserId?: string | null;
  /** `YYYY-MM-DD`. */
  dueDate?: string | null;
};

/**
 * Adds an action item, credited to the actor as its creator. Any member may
 * add one; an owner must be a current member, and a meeting must belong to the
 * same workspace.
 *
 * @param input - The item.
 * @param actor - Who is adding it; see {@link ActionItemActor}.
 * @returns The new item; 400 for an owner who is not a member; 404 for a
 *          non-member or a meeting outside the workspace.
 */
export async function addActionItem(
  input: NewActionItem,
  actor: ActionItemActor,
): Promise<ActionItemOutcome<ActionItemDTO>> {
  const { workspaceId, text } = input;
  const access = await requireWorkspaceRole(actor.userId, workspaceId);
  if (!access.ok) {
    return { ok: false, status: 404, message: "Workspace not found" };
  }

  const meetingId = input.meetingId ?? null;
  if (meetingId) {
    const meeting = await prisma.meeting.findFirst({
      where: { id: meetingId, workspaceId },
      select: { id: true },
    });
    if (!meeting) {
      return { ok: false, status: 404, message: "Meeting not found" };
    }
  }

  const ownerUserId = input.ownerUserId ?? null;
  if (ownerUserId && !(await isMember(ownerUserId, workspaceId))) {
    return notMemberOwner;
  }

  const created = await prisma.actionItem.create({
    data: {
      workspaceId,
      meetingId,
      text,
      ownerUserId,
      dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
      createdById: actor.userId,
    },
    include: actionItemInclude,
  });
  const [dto] = await toActionItemDTOs([created]);
  await broadcastActionItems(actor.io, {
    workspaceId,
    meetingId,
    changed: [dto!],
  });
  return { ok: true, value: dto! };
}

/**
 * Loads an item the actor may act on: it exists, sits in the actor's workspace
 * when one is given, and the actor is a member there.
 */
async function loadForActor(itemId: string, actor: ActionItemActor) {
  const item = await prisma.actionItem.findUnique({ where: { id: itemId } });
  if (!item) return null;
  if (actor.workspaceId && item.workspaceId !== actor.workspaceId) return null;
  const access = await requireWorkspaceRole(actor.userId, item.workspaceId);
  if (!access.ok) return null;
  return { item, role: access.role };
}

/**
 * Changes an action item. Any member may change its status, owner, due date or
 * text; an owner must be a current member, and assigning or clearing one also
 * clears the name as spoken.
 *
 * @param itemId - The item.
 * @param change - The fields to change.
 * @param actor - Who is acting; see {@link ActionItemActor}.
 * @returns The updated item; 400 for an owner who is not a member; 404 for a
 *          missing item, one outside the actor's workspace, or a non-member.
 */
export async function changeActionItem(
  itemId: string,
  change: ActionItemChange,
  actor: ActionItemActor,
): Promise<ActionItemOutcome<ActionItemDTO>> {
  const loaded = await loadForActor(itemId, actor);
  if (!loaded) return missing;
  const { item } = loaded;

  const { status, ownerUserId, dueDate, text } = change;
  if (ownerUserId && !(await isMember(ownerUserId, item.workspaceId))) {
    return notMemberOwner;
  }

  const updated = await prisma.actionItem.update({
    where: { id: itemId },
    data: {
      ...(text !== undefined ? { text } : {}),
      ...(dueDate !== undefined
        ? {
            dueDate: dueDate === null ? null : new Date(`${dueDate}T00:00:00Z`),
          }
        : {}),
      ...(ownerUserId !== undefined ? { ownerUserId, ownerName: null } : {}),
      ...(status === "OPEN" ? { status, completedAt: null } : {}),
      ...(status === "DONE"
        ? {
            status,
            completedAt: item.status === "DONE" ? item.completedAt : new Date(),
          }
        : {}),
    },
    include: actionItemInclude,
  });
  const [dto] = await toActionItemDTOs([updated]);
  await broadcastActionItems(actor.io, {
    workspaceId: item.workspaceId,
    meetingId: item.meetingId,
    changed: [dto!],
  });
  return { ok: true, value: dto! };
}

/**
 * Deletes an action item. Allowed for an admin, the item's owner or whoever
 * created it.
 *
 * @param itemId - The item.
 * @param actor - Who is acting; see {@link ActionItemActor}.
 * @returns The deleted item's id and text; 403 for anyone else; 404 as for
 *          {@link changeActionItem}.
 */
export async function removeActionItem(
  itemId: string,
  actor: ActionItemActor,
): Promise<ActionItemOutcome<{ id: string; text: string }>> {
  const loaded = await loadForActor(itemId, actor);
  if (!loaded) return missing;
  const { item, role } = loaded;

  const allowed =
    role !== "MEMBER" ||
    item.ownerUserId === actor.userId ||
    item.createdById === actor.userId;
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      message:
        "Only an admin, the owner or the creator can delete an action item",
    };
  }

  await prisma.actionItem.deleteMany({ where: { id: itemId } });
  await broadcastActionItems(actor.io, {
    workspaceId: item.workspaceId,
    meetingId: item.meetingId,
    changed: [],
    removedIds: [itemId],
  });
  return { ok: true, value: { id: itemId, text: item.text } };
}
