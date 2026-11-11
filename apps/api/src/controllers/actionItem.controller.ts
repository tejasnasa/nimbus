/**
 * @module api/controllers/actionItem
 * @description The REST surface of action items: listing a workspace's, and
 * changing or deleting one.
 *
 * Any member may change an item's status, owner, due date or text. Deleting is
 * for an admin, the item's owner or whoever created it. Every change is
 * announced to the workspace as `meeting:action-items`.
 *
 * @important An item is addressed by its own id, so every route first loads the
 *            item and checks the caller's membership of the item's workspace,
 *            answering 404 for a non-member. An item from another workspace is
 *            indistinguishable from one that does not exist and can be neither
 *            read, changed nor deleted.
 *
 * @important An owner must be a current member of the item's workspace.
 *            Assigning or clearing an owner also clears the name as spoken, so
 *            the item never shows a stale name next to a different owner.
 */
import { prisma } from "@nimbus/db";
import {
  actionItemListQuerySchema,
  actionItemPatchSchema,
  ServerResponse,
  type ActionItemDTO,
  type ActionItemListDTO,
} from "@nimbus/types";
import {
  actionItemInclude,
  broadcastActionItems,
  toActionItemDTOs,
} from "../lib/meeting/actionItems";
import type { MeetingBroadcaster } from "../lib/meeting/lifecycle";
import { requireWorkspaceRole } from "../lib/workspaceAccess";

/** The 404 for an item that is missing or in a workspace the caller is not in. */
const notFoundItem = () => ServerResponse.notFound("Action item not found");

/**
 * Lists a workspace's action items.
 *
 * Open items come with the soonest due date first and undated ones last.
 *
 * @param userId - The authenticated user.
 * @param query - The raw query string values (`workspaceId`, `status`, `owner`,
 *                `cursor`, `limit`).
 * @returns A page of items and the cursor for the next; 404 for a non-member.
 */
export async function listActionItems(userId: string, query: unknown) {
  const parsed = actionItemListQuerySchema.safeParse(query);
  if (!parsed.success) return ServerResponse.badRequest("Invalid query");

  try {
    const { workspaceId, status, owner, cursor, limit } = parsed.data;
    const access = await requireWorkspaceRole(userId, workspaceId);
    if (!access.ok) return access.response;

    // Scoping the cursor to the workspace keeps a foreign id from paging
    // another workspace's items.
    const anchor = cursor
      ? await prisma.actionItem.findFirst({
          where: { id: cursor, workspaceId },
          select: { id: true },
        })
      : null;
    if (cursor && !anchor) return ServerResponse.badRequest("Invalid cursor");

    const rows = await prisma.actionItem.findMany({
      where: {
        workspaceId,
        ...(status === "open" ? { status: "OPEN" as const } : {}),
        ...(status === "done" ? { status: "DONE" as const } : {}),
        ...(owner === "me" ? { ownerUserId: userId } : {}),
      },
      orderBy: [
        { dueDate: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
      ...(anchor ? { cursor: { id: anchor.id }, skip: 1 } : {}),
      include: actionItemInclude,
    });
    const page = rows.slice(0, limit);
    return ServerResponse.ok<ActionItemListDTO>({
      items: await toActionItemDTOs(page),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    });
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}

/**
 * Changes an action item.
 *
 * @param userId - The authenticated user.
 * @param itemId - The item.
 * @param body - The raw request body: any of `status`, `ownerUserId`, `dueDate`, `text`.
 * @param deps.io - Broadcaster for `meeting:action-items`.
 * @returns The updated item; 400 for an invalid body or an owner who is not a
 *          member; 404 for a missing item or a non-member.
 */
export async function patchActionItem(
  userId: string,
  itemId: string,
  body: unknown,
  deps: { io?: MeetingBroadcaster } = {},
) {
  const parsed = actionItemPatchSchema.safeParse(body);
  if (!parsed.success) return ServerResponse.badRequest("Invalid change");

  try {
    const item = await prisma.actionItem.findUnique({ where: { id: itemId } });
    if (!item) return notFoundItem();
    const access = await requireWorkspaceRole(userId, item.workspaceId);
    if (!access.ok) return notFoundItem();

    const { status, ownerUserId, dueDate, text } = parsed.data;
    if (ownerUserId) {
      const owner = await prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: ownerUserId,
            workspaceId: item.workspaceId,
          },
        },
        select: { userId: true },
      });
      if (!owner) {
        return ServerResponse.badRequest(
          "The owner must be a member of this workspace",
        );
      }
    }

    const updated = await prisma.actionItem.update({
      where: { id: itemId },
      data: {
        ...(text !== undefined ? { text } : {}),
        ...(dueDate !== undefined
          ? {
              dueDate:
                dueDate === null ? null : new Date(`${dueDate}T00:00:00Z`),
            }
          : {}),
        ...(ownerUserId !== undefined ? { ownerUserId, ownerName: null } : {}),
        ...(status === "OPEN" ? { status, completedAt: null } : {}),
        ...(status === "DONE"
          ? {
              status,
              completedAt:
                item.status === "DONE" ? item.completedAt : new Date(),
            }
          : {}),
      },
      include: actionItemInclude,
    });
    const [dto] = await toActionItemDTOs([updated]);
    await broadcastActionItems(deps.io, {
      workspaceId: item.workspaceId,
      meetingId: item.meetingId,
      changed: [dto!],
    });
    return ServerResponse.ok<ActionItemDTO>(dto!, "Action item updated");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}

/**
 * Deletes an action item.
 *
 * @param userId - The authenticated user.
 * @param itemId - The item.
 * @param deps.io - Broadcaster for `meeting:action-items`.
 * @returns 200 once deleted; 403 unless the caller is an admin, the owner or
 *          the creator; 404 for a missing item or a non-member.
 */
export async function deleteActionItem(
  userId: string,
  itemId: string,
  deps: { io?: MeetingBroadcaster } = {},
) {
  try {
    const item = await prisma.actionItem.findUnique({ where: { id: itemId } });
    if (!item) return notFoundItem();
    const access = await requireWorkspaceRole(userId, item.workspaceId);
    if (!access.ok) return notFoundItem();

    const allowed =
      access.role !== "MEMBER" ||
      item.ownerUserId === userId ||
      item.createdById === userId;
    if (!allowed) {
      return ServerResponse.forbidden(
        "Only an admin, the owner or the creator can delete an action item",
      );
    }

    await prisma.actionItem.deleteMany({ where: { id: itemId } });
    await broadcastActionItems(deps.io, {
      workspaceId: item.workspaceId,
      meetingId: item.meetingId,
      changed: [],
      removedIds: [itemId],
    });
    return ServerResponse.ok<{ id: string }>(
      { id: itemId },
      "Action item deleted",
    );
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}
