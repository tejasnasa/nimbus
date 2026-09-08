/**
 * @module api/socket/document
 * @description Server-side Yjs collaboration: per-document `Y.Doc` instances
 * hydrated from Postgres (`yjsState`) on first join, binary updates relayed
 * to room peers, debounced persistence (5s), and eviction when the last
 * socket leaves. AI-seeded `initialContent` is injected once via the doc's
 * metadata map, then cleared so rejoins never re-seed.
 *
 * @important The `docs` Map is process-local — horizontal scaling needs a
 *            shared Yjs store (or sticky sessions) or edits split by replica.
 */
import * as Y from "yjs";
import { Server, Socket } from "socket.io";
import { prisma } from "@nimbus/db";

/** In-memory Yjs docs keyed by document id (see module note on scaling). */
export const docs = new Map<string, Y.Doc>();

const DOC_ROOM = (docId: string) => `doc:${docId}`;

/** Loads (or lazily hydrates) the shared Yjs doc for an id. */
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

/** Persists the full Yjs state binary for a live doc. */
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

/** Resets the 5s persist timer — rapid edits collapse into one DB write. */
const debouncedSave = (docId: string) => {
  if (saveTimers.has(docId)) clearTimeout(saveTimers.get(docId)!);

  const timer = setTimeout(() => {
    saveSnapshot(docId);
    saveTimers.delete(docId);
  }, 5000);

  saveTimers.set(docId, timer);
};

/**
 * Registers Yjs doc handlers for one socket.
 *
 * `doc:join` membership-gates, injects one-shot AI content, and replays full
 * state; `doc:update` applies + relays + debounce-saves; `doc:leave` /
 * `disconnecting` snapshot + evict when the room drains.
 */
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

      // One-shot AI seed: publish initialContent through the shared doc, then
      // null it in the DB so later joins receive it via Yjs state, not re-seeding.
      if (document.type === "MARKDOWN" && document.initialContent) {
        const metadata = doc.getMap("metadata");
        metadata.set("initialContent", document.initialContent);

        await prisma.document.update({
          where: { id: docId },
          data: { initialContent: null },
        });
      }

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

  // Evict only when the room is truly empty — otherwise remaining peers keep
  // editing the live doc and the leaver's departure must not snapshot-race them.
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
