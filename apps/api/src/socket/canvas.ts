import { Server, Socket } from "socket.io";
import { prisma } from "@nimbus/db";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type CanvasState = readonly OrderedExcalidrawElement[];

export const canvases = new Map<string, CanvasState>();

const CANVAS_ROOM = (canvasId: string) => `canvas:${canvasId}`;

const getCanvas = async (canvasId: string) => {
  if (canvases.has(canvasId)) return canvases.get(canvasId)!;

  const document = await prisma.document.findUnique({
    where: { id: canvasId },
    select: { canvasData: true },
  });

  let elements: CanvasState = [];

  if (Array.isArray(document?.canvasData)) {
    elements = document.canvasData as unknown as CanvasState;
  }

  canvases.set(canvasId, elements);
  return elements;
};

const saveSnapshot = async (canvasId: string) => {
  const elements = canvases.get(canvasId);
  if (!elements) return;

  await prisma.document.update({
    where: { id: canvasId },
    data: {
      canvasData: elements,
    },
  });

  console.log("canvas snapshot saved:", canvasId);
};

const saveTimers = new Map<string, NodeJS.Timeout>();

const debouncedSave = (canvasId: string) => {
  if (saveTimers.has(canvasId)) clearTimeout(saveTimers.get(canvasId)!);

  const timer = setTimeout(() => {
    saveSnapshot(canvasId);
    saveTimers.delete(canvasId);
  }, 3000);

  saveTimers.set(canvasId, timer);
};

export const registerCanvasHandlers = (io: Server, socket: Socket) => {
  const user = socket.data.user;

  socket.on("canvas:join", async (canvasId: string) => {
    try {
      const document = await prisma.document.findUnique({
        where: { id: canvasId },
        include: { workspace: { include: { members: true } } },
      });

      if (!document) return socket.emit("canvas:error", "Canvas not found");

      const isMember = document.workspace.members.some(
        (m) => m.userId === user.id,
      );
      if (!isMember) return socket.emit("canvas:error", "Not a member");

      socket.join(CANVAS_ROOM(canvasId));

      const elements = await getCanvas(canvasId);

      socket.emit("canvas:state", {
        documentId: canvasId,
        elements,
      });

      console.log(`${user.name} joined canvas: ${canvasId}`);
    } catch (error) {
      console.error("Error joining canvas:", error);
      socket.emit("canvas:error", "Something went wrong");
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

        socket.to(CANVAS_ROOM(documentId)).emit("canvas:update", {
          documentId,
          elements,
        });

        debouncedSave(documentId);
      } catch (error) {
        console.error("Error updating canvas:", error);
        socket.emit("canvas:error", "Something went wrong");
      }
    },
  );

  socket.on("canvas:leave", async (canvasId: string) => {
    try {
      socket.leave(CANVAS_ROOM(canvasId));

      const room = io.sockets.adapter.rooms.get(CANVAS_ROOM(canvasId));
      if (!room || room.size === 0) {
        await saveSnapshot(canvasId);
        canvases.delete(canvasId);
        console.log("canvas removed from memory:", canvasId);
      }
    } catch (error) {
      console.error("Error leaving canvas:", error);
      socket.emit("canvas:error", "Something went wrong");
    }
  });

  socket.on("disconnecting", async () => {
    try {
      for (const room of socket.rooms) {
        if (!room.startsWith("canvas:")) continue;

        const canvasId = room.replace("canvas:", "");
        const roomSockets = io.sockets.adapter.rooms.get(room);

        if (roomSockets && roomSockets.size === 1) {
          await saveSnapshot(canvasId);
          canvases.delete(canvasId);
          console.log("canvas saved & cleaned:", canvasId);
        }
      }
    } catch (error) {
      console.error("disconnect error:", error);
    }
  });
};
