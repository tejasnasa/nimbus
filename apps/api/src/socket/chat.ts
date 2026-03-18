import { prisma } from "@nimbus/db";
import { Server, Socket } from "socket.io";

const registerChatHandlers = (io: Server, socket: Socket) => {
  const user = socket.data.user;

  socket.on("workspace:join", async (workspaceId: string) => {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId: workspaceId,
        },
      },
    });
    if (!member) return;

    socket.join(workspaceId);
  });

  socket.on(
    "message:send",
    async (data: { workspaceId: string; content: string }) => {
      const member = await prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: user.id,
            workspaceId: data.workspaceId,
          },
        },
      });

      if (!member) return;

      const message = await prisma.message.create({
        data: {
          content: data.content,
          userId: user.id,
          workspaceId: data.workspaceId,
        },
      });

      io.to(data.workspaceId).emit("message:new", {
        ...message,
        user: {
          id: user.id,
          name: user.name,
        },
      });
    },
  );

  socket.on("typing:start", (workspaceId: string) => {
    socket
      .to(workspaceId)
      .emit("typing:start", { userId: user.id, name: user.name });
  });

  socket.on("typing:stop", (workspaceId: string) => {
    socket
      .to(workspaceId)
      .emit("typing:stop", { userId: user.id, name: user.name });
  });

  socket.on("workspace:leave", async (workspaceId: string) => {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId: workspaceId,
        },
      },
    });
    if (!member) return;

    socket.leave(workspaceId);
  });
};

export default registerChatHandlers;
