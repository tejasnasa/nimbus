import { Server, Socket } from "socket.io";
import { prisma } from "@nimbus/db";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type CanvasState = readonly OrderedExcalidrawElement[];

export const canvases = new Map<string, CanvasState>();

const DOC_ROOM = (docId: string) => `doc:${docId}`;

const getCanvas = async (docId: string) => {
  if (canvases.has(docId)) return canvases.get(docId)!;

  const document = await prisma.document.findUnique({
    where: { id: docId },
    select: { canvasData: true },
  });

  let elements: CanvasState = [];

  if (Array.isArray(document?.canvasData)) {
    elements = document.canvasData as unknown as CanvasState;
  }

  canvases.set(docId, elements);
  return elements;
};

// 🔥 save snapshot
const saveSnapshot = async (docId: string) => {
  const elements = canvases.get(docId);
  if (!elements) return;

  await prisma.document.update({
    where: { id: docId },
    data: {
      canvasData: elements,
    },
  });

  console.log("canvas snapshot saved:", docId);
};

const saveTimers = new Map<string, NodeJS.Timeout>();

const debouncedSave = (docId: string) => {
  if (saveTimers.has(docId)) clearTimeout(saveTimers.get(docId)!);

  const timer = setTimeout(() => {
    saveSnapshot(docId);
    saveTimers.delete(docId);
  }, 3000);

  saveTimers.set(docId, timer);
};

export const registerDocumentHandlers = (io: Server, socket: Socket) => {
  const user = socket.data.user;

  socket.on("doc:join", async (docId: string) => {
    try {
      const document = await prisma.document.findUnique({
        where: { id: docId },
        include: { workspace: { include: { members: true } } },
      });

      if (!document) return socket.emit("doc:error", "Document not found");

      const isMember = document.workspace.members.some(
        (m) => m.userId === user.id,
      );
      if (!isMember) return socket.emit("doc:error", "Not a member");

      socket.join(DOC_ROOM(docId));

      const elements = await getCanvas(docId);

      socket.emit("canvas:state", {
        documentId: docId,
        elements,
      });

      console.log(`${user.name} joined canvas doc: ${docId}`);
    } catch (error) {
      console.error("Error joining doc:", error);
      socket.emit("doc:error", "Something went wrong");
    }
  });

  socket.on(
    "canvas:update",
    ({
      documentId,
      elements,
    }: {
      documentId: string;
      elements: CanvasState;
    }) => {
      try {
        canvases.set(documentId, elements);

        socket.to(DOC_ROOM(documentId)).emit("canvas:update", {
          documentId,
          elements,
        });

        debouncedSave(documentId);
      } catch (error) {
        console.error("Error updating canvas:", error);
        socket.emit("doc:error", "Something went wrong");
      }
    },
  );

  socket.on("doc:leave", async (docId: string) => {
    try {
      socket.leave(DOC_ROOM(docId));

      const room = io.sockets.adapter.rooms.get(DOC_ROOM(docId));
      if (!room || room.size === 0) {
        await saveSnapshot(docId);
        canvases.delete(docId);
        console.log("canvas removed from memory:", docId);
      }
    } catch (error) {
      console.error("Error leaving doc:", error);
      socket.emit("doc:error", "Something went wrong");
    }
  });

  socket.on("disconnecting", async () => {
    try {
      for (const room of socket.rooms) {
        if (!room.startsWith("doc:")) continue;

        const docId = room.replace("doc:", "");
        const roomSockets = io.sockets.adapter.rooms.get(room);

        if (roomSockets && roomSockets.size === 1) {
          await saveSnapshot(docId);
          canvases.delete(docId);
          console.log("canvas saved & cleaned:", docId);
        }
      }
    } catch (error) {
      console.error("disconnect error:", error);
    }
  });
};
