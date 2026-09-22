/**
 * @module api/lib/accountDeletion
 * @description Cascade policy run by better-auth's `deleteUser.beforeDelete`
 * hook. Lives in its own module so the policy is unit-testable independently
 * of the better-auth wiring (the `beforeDelete` callback is otherwise locked
 * inside `lib/auth.ts`).
 *
 * @important Runs *before* better-auth's own `internalAdapter.deleteUser`,
 *            because `WorkspaceMember.user` is `onDelete: Cascade` and that
 *            destroy is the only place ownership is recorded. Once the user
 *            row goes, no code can ask "what did they own".
 *
 * @important Skips for NimbusBot. The bot is added as ADMIN to every
 *            workspace and cannot sign in, so the delete path should be
 *            unreachable in practice — but the guard costs one line and its
 *            absence would risk deleting every workspace in the system.
 */
import { prisma } from "@nimbus/db";

/**
 * A user-shaped object carrying the fields this policy needs. better-auth's
 * `User` type satisfies this — it has `id` at minimum — and keeping the
 * shape minimal here makes the policy trivially callable from tests.
 */
export type UserLike = { id: string };

/**
 * Cascade-deletes every workspace the user is the sole OWNER of.
 *
 * Workspace → cascades `WorkspaceMember`, `Message`, and `Document` via
 * schema (`onDelete: Cascade` on those relations). The user's remaining
 * membership rows (in workspaces they did *not* own) and their messages in
 * those workspaces are left intact here — better-auth's own
 * `internalAdapter.deleteUser` cascades them on its own connection after
 * this hook returns.
 *
 * @param user - The user about to be deleted. The bot is identified by
 *               `BOT_USERID`; the cascade is a no-op for the bot.
 * @returns The number of owned workspaces deleted (0 for the bot, and for a
 *          user who owns no workspaces). Exposed primarily so tests can
 *          assert the policy took the right branch.
 */
export async function cascadeOwnedWorkspaces(
  user: UserLike,
): Promise<{ deletedCount: number }> {
  if (user.id === process.env.BOT_USERID) {
    return { deletedCount: 0 };
  }

  const ownedWorkspaces = await prisma.workspaceMember.findMany({
    where: { userId: user.id, role: "OWNER" },
    select: { workspaceId: true },
  });

  if (ownedWorkspaces.length === 0) {
    return { deletedCount: 0 };
  }

  const workspaceIds = ownedWorkspaces.map((m) => m.workspaceId);

  await prisma.$transaction(async (tx) => {
    // Workspace → cascades WorkspaceMember, Message, Document via schema.
    await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  });

  return { deletedCount: workspaceIds.length };
}
