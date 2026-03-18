import { prisma } from "@nimbus/db";
import { ServerResponse } from "@nimbus/types";

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

    return ServerResponse.ok(messages.reverse(), "Messages retrieved");
  } catch (error) {
    return ServerResponse.internalError();
  }
};
