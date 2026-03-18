import { prisma } from "@nimbus/db";
import { Server, Socket } from "socket.io";

const registerChatHandlers = (io: Server, socket: Socket) => {
  const user = socket.data.user;

  socket.on("workspace:join", (workspaceId: string) => {
    socket.join(workspaceId);
  });

  socket.on(
    "message:send",
    async (data: { workspaceId: string; content: string }) => {
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
};

export default registerChatHandlers;
