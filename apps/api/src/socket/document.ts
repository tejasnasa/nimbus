/**
 * @module api/socket/document
 * @description Server-side Yjs collaboration: per-document `Y.Doc` instances
 * hydrated from Postgres (`yjsState`) on first join, binary updates relayed
 * to room peers, debounced persistence (5s), and eviction when the last
 * socket leaves.
 *
 * Cursor and selection presence rides alongside as y-protocols awareness. The
 * server keeps one `Awareness` per live document (never a participant itself),
 * applies each socket's update after rewriting the identity inside it from the
 * session, relays it to the room, replays everyone's state to a newcomer, and
 * removes exactly the client ids a socket owned when it leaves or drops.
 *
 * Every snapshot also stores the document's plain text (`searchText`), which
 * feeds keyword search. A document whose AI seed has not been consumed yet keeps
 * the text it was created with, since the editor has not written it into the
 * Yjs tree.
 *
 * AI-seeded `initialContent` is injected via the doc's metadata map on join,
 * but the database column is cleared only once a snapshot proves the client
 * consumed the seed — nulling it at join time opens a window where a client
 * that never applies the template loses the document outright.
 *
 * @important The `docs` Map and the presence map beside it are process-local —
 *            horizontal scaling needs a shared Yjs store (or sticky sessions)
 *            or edits split by replica. Presence has the same limit: peers on
 *            another replica see broadcasts through the Redis adapter, but a
 *            newcomer is only replayed the states held by its own replica.
 *
 * @important Eviction must re-check room membership *after* any awaited
 *            snapshot. A rejoin that lands during the await has already
 *            re-registered the room, and deleting the map entry afterwards
 *            would leave a live socket with no doc — every later update is
 *            then dropped silently. `evictDocument` is the only sanctioned
 *            way to remove an entry. It also destroys the document's
 *            `Awareness` (which owns a timer). Presence is created in
 *            `doc:join` only after the last await, so the re-check stays valid.
 *
 * @important Awareness is never trusted: updates are accepted only from a
 *            socket in the document's room, capped at 64 KB and rate-limited,
 *            rebuilt from an allow-list with the identity stamped from the
 *            session, and may only touch client ids that socket (or another
 *            session of the same user) owns.
 */
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { Server, Socket } from "socket.io";
import { prisma } from "@nimbus/db";
import {
  MAX_AWARENESS_BYTES,
  MAX_AWARENESS_ENTRIES,
  decodeAwarenessEntries,
  encodeAwarenessEntries,
  sanitizeAwarenessState,
} from "../lib/awareness";
import { createRateLimiter } from "../lib/rateLimiter";
import { extractYjsText } from "../lib/documentText";
import { isRoomEmpty } from "./roomState";

/** In-memory Yjs docs keyed by document id (see module note on scaling). */
export const docs = new Map<string, Y.Doc>();

/** Who owns an awareness client id, so only they can change or remove it. */
type ClientOwner = { socketId: string; userId: string };

/** Live presence for one document: the awareness and who owns each client id. */
type DocPresence = { awareness: Awareness; owners: Map<number, ClientOwner> };

/** In-memory presence keyed by document id (see module note on scaling). */
export const presence = new Map<string, DocPresence>();

/** Awareness updates one socket may send per second before extras are dropped. */
const AWARENESS_PER_SECOND = 60;

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
 * Returns the document's presence, creating it on first use.
 *
 * The awareness belongs to a throwaway `Y.Doc` and its own local state is
 * cleared, so the server never appears as a collaborator in what it replays.
 * When it expires a silent client's state itself, the removal is broadcast
 * here because no socket handler is on the stack to do it.
 */
const getPresence = (io: Server, docId: string): DocPresence => {
  const existing = presence.get(docId);
  if (existing) return existing;

  const awareness = new Awareness(new Y.Doc());
  awareness.setLocalState(null);
  const created: DocPresence = { awareness, owners: new Map() };

  awareness.on(
    "update",
    ({ removed }: { removed: number[] }, origin: unknown) => {
      if (origin !== "timeout" || removed.length === 0) return;
      for (const id of removed) created.owners.delete(id);
      io.to(DOC_ROOM(docId)).emit(
        "doc:awareness",
        docId,
        Array.from(encodeAwarenessUpdate(awareness, removed)),
      );
    },
  );

  presence.set(docId, created);
  return created;
};

/**
 * Removes every client id a socket owns in a document and tells the room.
 *
 * Does nothing when the document has no presence or the socket owns nothing.
 *
 * @param socket - The leaving socket; its own copy of the removal is excluded.
 * @param docId - Document whose presence to clean.
 */
const releasePresence = (socket: Socket, docId: string) => {
  const entry = presence.get(docId);
  if (!entry) return;

  const ids = [...entry.owners]
    .filter(([, owner]) => owner.socketId === socket.id)
    .map(([clientId]) => clientId);
  if (ids.length === 0) return;

  removeAwarenessStates(entry.awareness, ids, "leave");
  for (const id of ids) entry.owners.delete(id);
  socket
    .to(DOC_ROOM(docId))
    .emit(
      "doc:awareness",
      docId,
      Array.from(encodeAwarenessUpdate(entry.awareness, ids)),
    );
};

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
  const text = extractYjsText(doc);

  try {
    await prisma.document.update({
      where: { id: docId },
      data: {
        yjsState: Buffer.from(state),
        ...(text || !seededDocs.has(docId) ? { searchText: text || null } : {}),
      },
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
  presence.get(docId)?.awareness.destroy();
  presence.delete(docId);
};

/**
 * Writes a pending debounced save now, so a read of the row sees the live
 * document. Does nothing when no save is pending.
 *
 * @param docId - Document to flush.
 */
export const flushDocument = async (docId: string) => {
  const timer = saveTimers.get(docId);
  if (!timer) return;
  clearTimeout(timer);
  saveTimers.delete(docId);
  await saveSnapshot(docId);
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
 * `disconnecting` snapshot + evict when the room drains; `doc:awareness`
 * validates, sanitises, applies and relays a cursor update, and leaving or
 * disconnecting removes the socket's cursors for everyone else.
 */
export const registerDocumentHandlers = (io: Server, socket: Socket) => {
  const user = socket.data.user;
  const withinAwarenessBudget = createRateLimiter(AWARENESS_PER_SECOND, 1000);

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

      // Replay everyone else's cursor so a newcomer does not see an empty room
      // until each peer next moves.
      const { awareness, owners } = getPresence(io, docId);
      const others = [...awareness.getStates().keys()].filter(
        (id) => owners.get(id)?.socketId !== socket.id,
      );
      if (others.length > 0) {
        socket.emit(
          "doc:awareness",
          docId,
          Array.from(encodeAwarenessUpdate(awareness, others)),
        );
      }

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

  socket.on("doc:awareness", async (docId: string, update: number[]) => {
    try {
      // Same gate as `doc:update`: only a socket that passed the membership
      // check in `doc:join` is in the room.
      if (typeof docId !== "string" || !socket.rooms.has(DOC_ROOM(docId))) {
        return socket.emit("doc:error", "Not joined to document");
      }

      if (!Array.isArray(update) || update.length > MAX_AWARENESS_BYTES) {
        return socket.emit("doc:error", "Awareness update too large");
      }

      // A burst beyond the budget is dropped, not errored: the next update
      // carries the latest cursor anyway.
      if (!withinAwarenessBudget()) return;

      const entries = decodeAwarenessEntries(Uint8Array.from(update));
      if (!entries) {
        return socket.emit("doc:error", "Malformed awareness update");
      }

      // Presence for a document nobody can load (deleted mid-session) has no home.
      if (!docs.has(docId) && !(await getDoc(docId))) {
        return socket.emit("doc:error", "Document not found");
      }

      // The await above can span a leave; re-check before touching shared state.
      if (!socket.rooms.has(DOC_ROOM(docId))) return;

      const { awareness, owners } = getPresence(io, docId);

      // Another session of the same user may take a client id over (a
      // reconnect can arrive before the old socket's disconnect is noticed),
      // but never a different user's.
      for (const entry of entries) {
        const owner = owners.get(entry.clientId);
        if (owner && owner.userId !== user.id) {
          return socket.emit("doc:error", "Awareness client id in use");
        }
      }
      const held = [...owners.values()].filter(
        (o) => o.socketId === socket.id,
      ).length;
      const claiming = entries.filter(
        (e) => owners.get(e.clientId)?.socketId !== socket.id,
      ).length;
      if (held + claiming > MAX_AWARENESS_ENTRIES) {
        return socket.emit("doc:error", "Too many awareness clients");
      }

      const clean = entries.map((entry) => ({
        ...entry,
        state: entry.state ? sanitizeAwarenessState(entry.state, user) : null,
      }));
      const encoded = encodeAwarenessEntries(clean);
      applyAwarenessUpdate(awareness, encoded, socket.id);

      // Ownership follows what the awareness accepted: a stale clock is ignored
      // by it, and recording an owner for a state that was never stored would
      // leave a client id with nothing to remove.
      for (const entry of clean) {
        if (entry.state && awareness.getStates().has(entry.clientId)) {
          owners.set(entry.clientId, { socketId: socket.id, userId: user.id });
        } else if (!entry.state) {
          owners.delete(entry.clientId);
        }
      }

      socket
        .to(DOC_ROOM(docId))
        .emit("doc:awareness", docId, Array.from(encoded));
    } catch (error) {
      console.error("Error applying awareness:", error);
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
      releasePresence(socket, docId);

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
      // Synchronous and first: the departing cursor must vanish for peers even
      // if a snapshot below is slow or fails.
      for (const room of socket.rooms) {
        if (room.startsWith("doc:")) releasePresence(socket, room.slice(4));
      }

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
