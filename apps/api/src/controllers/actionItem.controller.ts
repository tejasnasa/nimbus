/**
 * @module api/controllers/actionItem
 * @description The REST surface of action items: listing a workspace's, and
 * adding, changing or deleting one.
 *
 * Any member may add an item, or change one's status, owner, due date or text. Deleting is
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
 *            the item never shows a stale name next to a different owner. The
 *            rules for adding, changing and deleting live in
 *            `lib/meeting/actionItems`, shared with the assistant's tools.
 */
import { prisma } from "@nimbus/db";
import {
  actionItemCreateSchema,
  actionItemListQuerySchema,
  actionItemPatchSchema,
  ServerResponse,
  type ActionItemDTO,
  type ActionItemListDTO,
} from "@nimbus/types";
import {
  actionItemInclude,
  addActionItem,
  changeActionItem,
  removeActionItem,
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

/** Maps a refused change or deletion onto its response. */
function refusal(outcome: { status: 400 | 403 | 404; message: string }) {
  if (outcome.status === 400) return ServerResponse.badRequest(outcome.message);
  if (outcome.status === 403) return ServerResponse.forbidden(outcome.message);
  return notFoundItem();
}

/**
 * Adds an action item by hand, credited to the caller.
 *
 * @param userId - The authenticated user.
 * @param body - The raw request body: `workspaceId`, `text`, and optionally
 *               `meetingId`, `ownerUserId`, `dueDate`.
 * @param deps.io - Broadcaster for `meeting:action-items`.
 * @returns 201 with the new item; 400 for an invalid body or an owner who is
 *          not a member; 404 for a non-member or a meeting elsewhere.
 */
export async function createActionItem(
  userId: string,
  body: unknown,
  deps: { io?: MeetingBroadcaster } = {},
) {
  const parsed = actionItemCreateSchema.safeParse(body);
  if (!parsed.success) return ServerResponse.badRequest("Invalid action item");

  try {
    const outcome = await addActionItem(parsed.data, { userId, io: deps.io });
    if (!outcome.ok) {
      return outcome.status === 400
        ? ServerResponse.badRequest(outcome.message)
        : ServerResponse.notFound(outcome.message);
    }
    return ServerResponse.created<ActionItemDTO>(
      outcome.value,
      "Action item added",
    );
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
    const outcome = await changeActionItem(itemId, parsed.data, {
      userId,
      io: deps.io,
    });
    if (!outcome.ok) return refusal(outcome);
    return ServerResponse.ok<ActionItemDTO>(
      outcome.value,
      "Action item updated",
    );
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
    const outcome = await removeActionItem(itemId, { userId, io: deps.io });
    if (!outcome.ok) return refusal(outcome);
    return ServerResponse.ok<{ id: string }>(
      { id: outcome.value.id },
      "Action item deleted",
    );
  } catch (error) {
    return ServerResponse.internalError(error);
  }
}
