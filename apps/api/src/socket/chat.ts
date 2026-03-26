import { prisma } from "@nimbus/db";
import { Server, Socket } from "socket.io";
import { presenceService } from "../lib/presence";

const registerChatHandlers = (io: Server, socket: Socket) => {
  const user = socket.data.user;

  if (!user?.id) {
    socket.disconnect();
    return;
  }

  socket.on("workspace:join", async (workspaceId: string) => {
    console.log("JOIN EVENT RECEIVED:", workspaceId, "from", user.id);

    try {
      const member = await prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: user.id,
            workspaceId,
          },
        },
      });

      if (!member) {
        console.log("NOT A MEMBER:", user.id);
        return;
      }

      console.log("JOINING ROOM:", workspaceId);

      socket.join(workspaceId);

      console.log("ROOMS AFTER JOIN:", socket.rooms);

      await presenceService.userJoined(workspaceId, user.id);

      io.to(workspaceId).emit("presence:joined", {
        userId: user.id,
        name: user.name,
      });

      const onlineUserIds = await presenceService.getOnlineUsers(workspaceId);

      console.log("ONLINE USERS:", onlineUserIds);

      socket.emit("presence:online_users", onlineUserIds);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("workspace:leave", async (workspaceId: string) => {
    try {
      const member = await prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: user.id,
            workspaceId,
          },
        },
      });

      if (!member) return;

      socket.leave(workspaceId);

      await presenceService.userLeft(workspaceId, user.id);

      io.to(workspaceId).emit("presence:left", {
        userId: user.id,
      });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on(
    "message:send",
    async (data: { workspaceId: string; content: string }) => {
      try {
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
          name: user.name,
          image: user.image,
        });
      } catch (err) {
        console.error(err);
      }
    },
  );

  socket.on("typing:start", (workspaceId: string) => {
    socket.to(workspaceId).emit("typing:start", {
      userId: user.id,
      name: user.name,
    });
  });

  socket.on("typing:stop", (workspaceId: string) => {
    socket.to(workspaceId).emit("typing:stop", {
      userId: user.id,
      name: user.name,
    });
  });

  socket.on("disconnecting", async () => {
    try {
      await Promise.all(
        [...socket.rooms]
          .filter((room) => room !== socket.id)
          .map((workspaceId) =>
            presenceService.userLeft(workspaceId, user.id).then(() => {
              socket.to(workspaceId).emit("presence:left", {
                userId: user.id,
              });
            }),
          ),
      );
    } catch (err) {
      console.error(err);
    }
  });
};

export default registerChatHandlers;
