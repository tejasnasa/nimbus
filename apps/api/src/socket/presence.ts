import { Server, Socket } from "socket.io";
import { presenceService } from "../lib/presence";

export const registerPresenceHandlers = (io: Server, socket: Socket) => {
  const user = socket.data.user;

  socket.on("workspace:join", async (workspaceId: string) => {
    await presenceService.userJoined(workspaceId, user.id);

    io.to(workspaceId).emit("presence:joined", {
      userId: user.id,
      name: user.name,
    });

    const onlineUserIds = await presenceService.getOnlineUsers(workspaceId);
    socket.emit("presence:online_users", onlineUserIds);
  });

  socket.on("workspace:leave", async (workspaceId: string) => {
    await presenceService.userLeft(workspaceId, user.id);
    io.to(workspaceId).emit("presence:left", { userId: user.id });
  });

  socket.on("disconnecting", async () => {
    for (const workspaceId of socket.rooms) {
      if (workspaceId === socket.id) continue;
      await presenceService.userLeft(workspaceId, user.id);
      io.to(workspaceId).emit("presence:left", { userId: user.id });
    }
  });
};
