/**
 * @module api/lib/workspaceAccess
 * @description The shared workspace role guard for controllers that take a
 * workspace id: one membership lookup, one convention for refusing.
 *
 * The convention matches `getWorkspaceBySlugId`: a user who is not a member gets
 * **404**, because to them the workspace does not exist and a 403 would confirm
 * it does; a member below the required role gets **403**.
 *
 * @important This is a controller-layer guard, not a socket one. Socket handlers
 *            re-check membership per event with their own query. Use it at the
 *            top of every workspace-scoped controller, before any read or write.
 */
import { prisma } from "@nimbus/db";
import { ServerResponse } from "@nimbus/types";

/** Roles in ascending order of authority. */
export type WorkspaceRole = "MEMBER" | "ADMIN" | "OWNER";

const RANK: Record<WorkspaceRole, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

/** The outcome of the guard. */
export type WorkspaceAccess =
  | { readonly ok: true; readonly role: WorkspaceRole }
  | {
      readonly ok: false;
      readonly response: ReturnType<typeof ServerResponse.notFound>;
    };

/**
 * Checks that `userId` belongs to `workspaceId` with at least `minRole`.
 *
 * @param userId - The authenticated user.
 * @param workspaceId - The workspace's cuid (not its `slugId`).
 * @param minRole - The lowest role allowed; defaults to any member.
 * @returns `{ ok: true, role }`, or `{ ok: false, response }` carrying the 404
 *          or 403 the controller should return as-is.
 */
export async function requireWorkspaceRole(
  userId: string,
  workspaceId: string,
  minRole: WorkspaceRole = "MEMBER",
): Promise<WorkspaceAccess> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  });

  if (!membership) {
    return { ok: false, response: ServerResponse.notFound("Workspace not found") };
  }
  if (RANK[membership.role] < RANK[minRole]) {
    return {
      ok: false,
      response: ServerResponse.forbidden(
        "You do not have permission to do that in this workspace",
      ),
    };
  }
  return { ok: true, role: membership.role };
}
