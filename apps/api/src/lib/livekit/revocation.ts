/**
 * @module api/lib/livekit/revocation
 * @description Removes people from a workspace's call when their access to the
 * workspace ends.
 *
 * @important This is what keeps "a removed member loses access immediately"
 *            true for voice. A join token outlives the membership it was minted
 *            for and the connection outlives the token, so without an explicit
 *            kick a removed member would stay on the call. Every path that ends
 *            a membership (removal, workspace deletion, account deletion) calls
 *            in here.
 *
 * @important Best effort by design. A failure is logged and swallowed, and a
 *            404 (the room or participant is already gone, the normal case) is
 *            silent: revocation must never block or fail the operation that
 *            triggered it.
 */
import { getRoomServiceClient } from "./client";
import { roomNameFor } from "./rooms";

/** Whether the media server answered "no such room or participant". */
function isNotFound(error: unknown): boolean {
  const e = error as { status?: number; code?: string } | null;
  return e?.status === 404 || e?.code === "not_found";
}

/**
 * Disconnects one user from one workspace's call.
 *
 * @param workspaceId - The workspace whose room to remove the user from.
 * @param userId - The user, which is also their participant identity.
 */
export async function removeFromCall(
  workspaceId: string,
  userId: string,
): Promise<void> {
  try {
    await getRoomServiceClient().removeParticipant(
      roomNameFor(workspaceId),
      userId,
    );
  } catch (error) {
    if (isNotFound(error)) return;
    console.error(
      `[voice] could not remove ${userId} from the call of workspace ${workspaceId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Disconnects several users from one workspace's call.
 *
 * @param workspaceId - The workspace whose room to clear.
 * @param userIds - The users to remove.
 */
export async function removeAllFromCall(
  workspaceId: string,
  userIds: readonly string[],
): Promise<void> {
  await Promise.all(
    userIds.map((userId) => removeFromCall(workspaceId, userId)),
  );
}
