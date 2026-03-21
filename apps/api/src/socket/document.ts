import * as Y from "yjs";
import { Server, Socket } from "socket.io";
import { prisma } from "@nimbus/db";

export const docs = new Map<string, Y.Doc>();

const DOC_ROOM = (docId: string) => `doc:${docId}`;

const getDoc = async (docId: string) => {
  if (docs.has(docId)) return docs.get(docId)!;

  const doc = new Y.Doc();

  const document = await prisma.document.findUnique({
    where: { id: docId },
    select: { yjsState: true },
  });

  if (document?.yjsState) {
    Y.applyUpdate(doc, document.yjsState);
  }

  docs.set(docId, doc);
  return doc;
};

const saveSnapshot = async (docId: string) => {
  const doc = docs.get(docId);
  if (!doc) return;

  const state = Y.encodeStateAsUpdate(doc);

  await prisma.document.update({
    where: { id: docId },
    data: { yjsState: Buffer.from(state) },
  });

  console.log("snapshot saved for doc:", docId);
};

const saveTimers = new Map<string, NodeJS.Timeout>();

const debouncedSave = (docId: string) => {
  if (saveTimers.has(docId)) clearTimeout(saveTimers.get(docId)!);

  const timer = setTimeout(() => {
    saveSnapshot(docId);
    saveTimers.delete(docId);
  }, 5000);

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
      const doc = await getDoc(docId);

      const state = Y.encodeStateAsUpdate(doc);
      socket.emit("doc:state", Array.from(state));

      console.log(`${user.name} joined doc: ${docId}`);
    } catch (error) {
      console.error("Error joining doc:", error);
      socket.emit("doc:error", "Something went wrong");
    }
  });

  socket.on("doc:update", (docId: string, update: number[]) => {
    try {
      const doc = docs.get(docId);
      if (!doc) return;

      Y.applyUpdate(doc, Uint8Array.from(update));
      socket.to(DOC_ROOM(docId)).emit("doc:update", update);
      debouncedSave(docId);
    } catch (error) {
      console.error("Error applying update:", error);
      socket.emit("doc:error", "Something went wrong");
    }
  });

  socket.on("doc:leave", async (docId: string) => {
    try {
      socket.leave(DOC_ROOM(docId));

      const room = io.sockets.adapter.rooms.get(DOC_ROOM(docId));
      if (!room || room.size === 0) {
        await saveSnapshot(docId);
        docs.delete(docId);
        console.log("doc removed from memory:", docId);
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
          docs.delete(docId);
          console.log("doc saved and removed from memory:", docId);
        }
      }
    } catch (error) {
      console.error("disconnecting handler error:", error);
    }
  });
};
