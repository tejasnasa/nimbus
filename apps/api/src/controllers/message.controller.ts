/**
 * @module api/controllers/message
 * @description Chat history retrieval. Membership-gated; returns the latest
 * 50 messages in chronological order (queried newest-first for the `take`
 * window, then reversed) shaped as flat client DTOs.
 */
import { prisma } from "@nimbus/db";
import { ServerResponse } from "@nimbus/types";

/**
 * Fetches the latest 50 workspace messages, oldest-first.
 *
 * @param workspaceId - Workspace room identifier.
 * @param id - Acting user's ID (must be a member).
 */
export const getWorkspaceMessages = async (workspaceId: string, id: string) => {
  try {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: id,
          workspaceId,
        },
      },
    });

    if (!member) return ServerResponse.unauthorized();

    const messages = await prisma.message.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: {
        user: true,
      },
      take: 50,
    });

    return ServerResponse.ok(
      messages
        .map((msg) => ({
          id: msg.id,
          content: msg.content,
          userId: msg.userId,
          workspaceId: msg.workspaceId,
          createdAt: msg.createdAt,
          name: msg.user.name,
          image: msg.user.image ?? undefined,
        }))
        .reverse(),
      "Messages retrieved",
    );
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};
