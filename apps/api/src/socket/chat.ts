import { prisma } from "@nimbus/db";
import { Server, Socket } from "socket.io";
import { generateBotResponse } from "../lib/bot";
import { generateCanvasDocument } from "../lib/canvasGeneration";
import { generateMarkdownDocument } from "../lib/markdownGeneration";
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

        if (data.content.toLowerCase().includes("@nimbusbot")) {
          (async () => {
            const botResult = await generateBotResponse(data.workspaceId);

            const botMessage = await prisma.message.create({
              data: {
                content:
                  botResult.kind === "reply"
                    ? botResult.content
                    : botResult.chatMessage,
                userId: process.env.BOT_USERID!,
                workspaceId: data.workspaceId,
              },
              include: { user: true },
            });

            io.to(data.workspaceId).emit("message:new", {
              ...botMessage,
              name: botMessage.user.name,
              image: botMessage.user.image,
            });

            if (botResult.kind === "create_document") {
              io.to(data.workspaceId).emit("doc:ai:start", {
                type: botResult.type,
                label: botResult.label,
              });

              try {
                if (botResult.type === "MARKDOWN") {
                  const { fullContent } = await generateMarkdownDocument(
                    botResult.prompt,
                    botResult.label,
                    (token) => {
                      io.to(data.workspaceId).emit("doc:ai:progress", {
                        token,
                      });
                    },
                    (token) => {
                      io.to(data.workspaceId).emit("doc:ai:thinking", {
                        token,
                      });
                    },
                  );

                  const doc = await prisma.document.create({
                    data: {
                      title: botResult.label,
                      type: "MARKDOWN",
                      workspaceId: data.workspaceId,
                      initialContent: fullContent,
                    },
                  });

                  io.to(data.workspaceId).emit("doc:ai:complete", {
                    documentId: doc.id,
                    label: doc.title,
                    type: doc.type,
                  });
                } else {
                  const { canvasData } = await generateCanvasDocument(
                    botResult.prompt,
                    botResult.label,
                    (token) => {
                      io.to(data.workspaceId).emit("doc:ai:thinking", {
                        token,
                      });
                    },
                    (status) => {
                      io.to(data.workspaceId).emit("doc:ai:progress", {
                        status,
                      });
                    },
                  );

                  const doc = await prisma.document.create({
                    data: {
                      title: botResult.label,
                      type: "CANVAS",
                      workspaceId: data.workspaceId,
                      canvasData,
                    },
                  });

                  io.to(data.workspaceId).emit("doc:ai:complete", {
                    documentId: doc.id,
                    label: doc.title,
                    type: doc.type,
                    canvasData,
                  });
                }
              } catch (err) {
                console.error("Doc generation error:", err);
                io.to(data.workspaceId).emit("doc:ai:error", {
                  message: "Document generation failed. Please try again.",
                });

                try {
                  const errorBotMessage = await prisma.message.create({
                    data: {
                      content: `Sorry, I failed to create the document "${botResult.label}". Please try again.`,
                      userId: process.env.BOT_USERID!,
                      workspaceId: data.workspaceId,
                    },
                    include: { user: true },
                  });

                  io.to(data.workspaceId).emit("message:new", {
                    ...errorBotMessage,
                    name: errorBotMessage.user.name,
                    image: errorBotMessage.user.image,
                  });
                } catch (dbErr) {
                  console.error("Error creating failure bot message:", dbErr);
                }
              }
            }
          })().catch((err) => console.error("Bot Reply Error:", err));
        }
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
