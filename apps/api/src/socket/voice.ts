import { prisma } from "@nimbus/db";
import { Server, Socket } from "socket.io";
import { voicePresenceService } from "../lib/voicePresence";

const VOICE_ROOM = (workspaceId: string) => `voice:${workspaceId}`;

export const registerVoiceHandlers = (io: Server, socket: Socket) => {
  const user = socket.data.user;

  if (!user?.id) return;

  socket.on("voice:join", async (workspaceId: string) => {
    try {
      const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: user.id, workspaceId } },
      });
      if (!member) return;

      await voicePresenceService.userJoined(workspaceId, {
        userId: user.id,
        name: user.name,
        image: user.image ?? null,
        isMuted: true,
      });

      socket.join(VOICE_ROOM(workspaceId));

      const currentUsers =
        await voicePresenceService.getVoiceUsers(workspaceId);
      const others = currentUsers.filter((u) => u.userId !== user.id);
      socket.emit("voice:current-users", { users: others });
      socket.to(VOICE_ROOM(workspaceId)).emit("voice:user-joined", {
        userId: user.id,
        name: user.name,
      });

      console.log(`${user.name} joined voice in workspace: ${workspaceId}`);
    } catch (err) {
      console.error("voice:join error", err);
    }
  });

  socket.on("voice:leave", async (workspaceId: string) => {
    try {
      await voicePresenceService.userLeft(workspaceId, user.id);
      socket.leave(VOICE_ROOM(workspaceId));
      io.to(VOICE_ROOM(workspaceId)).emit("voice:user-left", {
        userId: user.id,
      });
      console.log(`${user.name} left voice in workspace: ${workspaceId}`);
    } catch (err) {
      console.error("voice:leave error", err);
    }
  });

  socket.on(
    "voice:offer",
    (data: {
      workspaceId: string;
      targetUserId: string;
      offer: RTCSessionDescriptionInit;
    }) => {
      const targetSocket = getSocketByUserId(io, data.targetUserId);
      if (!targetSocket) return;
      targetSocket.emit("voice:offer", {
        fromUserId: user.id,
        offer: data.offer,
      });
    },
  );

  socket.on(
    "voice:answer",
    (data: {
      workspaceId: string;
      targetUserId: string;
      answer: RTCSessionDescriptionInit;
    }) => {
      const targetSocket = getSocketByUserId(io, data.targetUserId);
      if (!targetSocket) return;
      targetSocket.emit("voice:answer", {
        fromUserId: user.id,
        answer: data.answer,
      });
    },
  );

  socket.on(
    "voice:ice-candidate",
    (data: {
      workspaceId: string;
      targetUserId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      const targetSocket = getSocketByUserId(io, data.targetUserId);
      if (!targetSocket) return;
      targetSocket.emit("voice:ice-candidate", {
        fromUserId: user.id,
        candidate: data.candidate,
      });
    },
  );

  socket.on(
    "voice:mute-state",
    async (data: { workspaceId: string; isMuted: boolean }) => {
      try {
        await voicePresenceService.updateMuteState(
          data.workspaceId,
          user.id,
          data.isMuted,
        );
        socket.to(VOICE_ROOM(data.workspaceId)).emit("voice:mute-state", {
          userId: user.id,
          isMuted: data.isMuted,
        });
      } catch (err) {
        console.error("voice:mute-state error", err);
      }
    },
  );

  socket.on("disconnecting", async () => {
    try {
      const voiceRooms = [...socket.rooms].filter((r) =>
        r.startsWith("voice:"),
      );
      await Promise.all(
        voiceRooms.map(async (room) => {
          const workspaceId = room.replace("voice:", "");
          await voicePresenceService.userLeft(workspaceId, user.id);
          socket.to(room).emit("voice:user-left", { userId: user.id });
        }),
      );
    } catch (err) {
      console.error("voice disconnecting error", err);
    }
  });
};

function getSocketByUserId(io: Server, userId: string) {
  for (const [, socket] of io.sockets.sockets) {
    if (socket.data?.user?.id === userId) return socket;
  }
  return null;
}
