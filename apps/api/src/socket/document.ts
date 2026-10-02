/**
 * @module api/socket/document
 * @description Server-side Yjs collaboration: per-document `Y.Doc` instances
 * hydrated from Postgres (`yjsState`) on first join, binary updates relayed
 * to room peers, debounced persistence (5s), and eviction when the last
 * socket leaves.
 *
 * AI-seeded `initialContent` is injected via the doc's metadata map on join,
 * but the database column is cleared only once a snapshot proves the client
 * consumed the seed — nulling it at join time opens a window where a client
 * that never applies the template loses the document outright.
 *
 * @important The `docs` Map is process-local — horizontal scaling needs a
 *            shared Yjs store (or sticky sessions) or edits split by replica.
 *
 * @important Eviction must re-check room membership *after* any awaited
 *            snapshot. A rejoin that lands during the await has already
 *            re-registered the room, and deleting the map entry afterwards
 *            would leave a live socket with no doc — every later update is
 *            then dropped silently. `evictDocument` is the only sanctioned
 *            way to remove an entry.
 */
import * as Y from "yjs";
import { Server, Socket } from "socket.io";
import { prisma } from "@nimbus/db";
import { isRoomEmpty } from "./roomState";

/** In-memory Yjs docs keyed by document id (see module note on scaling). */
export const docs = new Map<string, Y.Doc>();

/**
 * Documents whose AI seed has been published but not yet observed as consumed
 * (the client deletes `initialContent` from the metadata map once it has
 * applied the template). Only these may have the column cleared on save.
 */
const seededDocs = new Set<string>();

/** Pending debounced persist timers, keyed by document id. */
const saveTimers = new Map<string, NodeJS.Timeout>();

const DOC_ROOM = (docId: string) => `doc:${docId}`;

/**
 * Loads (or lazily hydrates) the shared Yjs doc for an id.
 *
 * @returns The doc, or `null` when no such document exists — callers must not
 *          cache or mutate a doc that was never persisted.
 */
const getDoc = async (docId: string): Promise<Y.Doc | null> => {
  if (docs.has(docId)) return docs.get(docId)!;

  const document = await prisma.document.findUnique({
    where: { id: docId },
    select: { yjsState: true },
  });

  if (!document) return null;

  const doc = new Y.Doc();

  if (document.yjsState) {
    Y.applyUpdate(doc, document.yjsState);
  }

  docs.set(docId, doc);
  return doc;
};

/**
 * Clears `initialContent` once the seed is demonstrably in the Yjs state.
 *
 * The client removes `initialContent` from the metadata map as it applies the
 * template, so an absent key on a seeded doc means the content has been
 * consumed and persisted by the snapshot that just ran. Until then the column
 * stays set, so a rejoin re-seeds rather than presenting an empty document.
 */
const clearSeedIfConsumed = async (docId: string, doc: Y.Doc) => {
  if (!seededDocs.has(docId)) return;
  if (doc.getMap("metadata").has("initialContent")) return;

  seededDocs.delete(docId);
  await prisma.document.update({
    where: { id: docId },
    data: { initialContent: null },
  });
};

/** Persists the full Yjs state binary for a live doc. */
const saveSnapshot = async (docId: string) => {
  const doc = docs.get(docId);
  if (!doc) return;

  const state = Y.encodeStateAsUpdate(doc);

  try {
    await prisma.document.update({
      where: { id: docId },
      data: { yjsState: Buffer.from(state) },
    });

    await clearSeedIfConsumed(docId, doc);
  } catch (error) {
    // A document deleted mid-session has no row to update; the debounce timer
    // would otherwise surface this as an unhandled rejection.
    console.error("Error saving doc snapshot:", error);
  }
};

/**
 * Drops every trace of a document from process memory.
 *
 * Exported so document deletion can evict without leaving a pending debounce
 * that would re-persist a deleted row.
 *
 * @param docId - Document to evict.
 */
export const evictDocument = (docId: string) => {
  const timer = saveTimers.get(docId);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(docId);
  }
  docs.delete(docId);
  seededDocs.delete(docId);
};

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
      if (!doc) return socket.emit("doc:error", "Document not found");

      // One-shot AI seed: publish initialContent through the shared doc so the
      // joining client can apply it as a template. The column is NOT cleared
      // here — a client that unmounts before applying the template would
      // otherwise lose the document entirely. It is cleared on the first
      // snapshot that proves the client consumed the seed.
      if (document.type === "MARKDOWN" && document.initialContent) {
        if (doc.getXmlFragment("prosemirror").length === 0) {
          doc.getMap("metadata").set("initialContent", document.initialContent);
          seededDocs.add(docId);
        } else {
          // The body already reached the Yjs state on an earlier attempt, so
          // the column is redundant and can go.
          await prisma.document.update({
            where: { id: docId },
            data: { initialContent: null },
          });
        }
      }

      const state = Y.encodeStateAsUpdate(doc);
      socket.emit("doc:state", Array.from(state));

      console.log(`${user.name} joined doc: ${docId}`);
    } catch (error) {
      console.error("Error joining doc:", error);
      socket.emit("doc:error", "Something went wrong");
    }
  });

  socket.on("doc:update", async (docId: string, update: number[]) => {
    try {
      // Room presence stands in for a membership check: `doc:join` verifies the
      // caller belongs to the document's workspace before joining the room, so
      // only a socket that passed that gate is in it. Without this, any
      // authenticated socket that knows a docId can mutate a live document and
      // have the change broadcast to real participants and written to the
      // database. `canvas:update` guards the same way — keep the two in step.
      if (!socket.rooms.has(DOC_ROOM(docId))) {
        return socket.emit("doc:error", "Not joined to document");
      }

      // A socket in the room with no in-memory doc is an invariant violation,
      // not a normal state — rehydrating keeps an eviction bug from turning
      // into silent, permanent data loss.
      const doc = docs.get(docId) ?? (await getDoc(docId));
      if (!doc) return socket.emit("doc:error", "Document not found");

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
  //
  // The emptiness check is deliberately repeated *after* the awaited snapshot:
  // a rejoin arriving during the await has already put its socket back in the
  // room, and evicting then would strand it without a doc.
  socket.on("doc:leave", async (docId: string) => {
    try {
      socket.leave(DOC_ROOM(docId));
      const room = DOC_ROOM(docId);

      if (isRoomEmpty(io, room, socket)) {
        await saveSnapshot(docId);

        if (isRoomEmpty(io, room, socket)) {
          evictDocument(docId);
          console.log("doc removed from memory:", docId);
        }
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

        if (!isRoomEmpty(io, room, socket)) continue;

        await saveSnapshot(docId);

        if (isRoomEmpty(io, room, socket)) {
          evictDocument(docId);
          console.log("doc saved and removed from memory:", docId);
        }
      }
    } catch (error) {
      console.error("disconnecting handler error:", error);
    }
  });
};
