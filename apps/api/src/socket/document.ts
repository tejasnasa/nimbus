import * as Y from "yjs";
import { Server, Socket } from "socket.io";
import { prisma } from "@nimbus/db";

const docs = new Map<string, Y.Doc>();

const getDoc = (docId: string) => {
  if (!docs.has(docId)) {
    docs.set(docId, new Y.Doc());
  }
  return docs.get(docId)!;
};

export const registerDocumentHandlers = (io: Server, socket: Socket) => {
  const user = socket.data.user;

  socket.on("doc:join", async (docId: string) => {
    const document = await prisma.document.findUnique({
      where: { id: docId },
      include: { workspace: { include: { members: true } } },
    });

    if (!document) return socket.emit("doc:error", "Document not found");

    const isMember = document.workspace.members.some((m) => m.userId === user.id);
    if (!isMember) return socket.emit("doc:error", "Not a member");

    socket.join(docId);
    const doc = getDoc(docId);

    const state = Y.encodeStateAsUpdate(doc);
    socket.emit("doc:state", Array.from(state));

    console.log(`${user.name} joined doc: ${docId}`);
  });

  socket.on("doc:update", (docId: string, update: number[]) => {
    const doc = getDoc(docId);
    Y.applyUpdate(doc, Uint8Array.from(update));
    socket.to(docId).emit("doc:update", update);
  });

  socket.on("doc:leave", (docId: string) => {
    socket.leave(docId);
  });
};