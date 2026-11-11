/**
 * @module api/socket/canvas
 * @description Full-state Excalidraw sync (last-write-wins, no CRDT):
 * per-canvas element arrays hydrated from `canvasData` on first join,
 * replaced wholesale on `canvas:update`, relayed to room peers, debounced
 * persistence (3s), and eviction when the last socket leaves. Every snapshot
 * also stores the canvas's text (`searchText`) for keyword search.
 *
 * Pointers are the one thing here that is not state: `canvas:pointer` relays a
 * member's cursor (and selection) to the room for Excalidraw's collaborator
 * layer, stamped with the identity of the authenticated socket, never stored,
 * and followed by `canvas:pointer-leave` when the socket leaves or drops.
 *
 * @important The `canvases` Map is process-local (same scaling caveat as the
 *            Yjs docs). An empty array from a client that has not yet applied
 *            the authoritative state must never clobber the room — see the
 *            `canvas:update` guard, which keys off the sender's `initialized`
 *            flag rather than the length of the array it sent.
 *
 * @important Pointer events carry no server memory, so presence on a canvas is
 *            just the room and is as process-local as the rest (peers on other
 *            replicas still see broadcasts through the Redis adapter). Identity
 *            on a relayed pointer always comes from `socket.data.user`; any
 *            identity a client puts in its payload is ignored.
 *
 * @important Eviction re-checks room membership after any awaited snapshot, for
 *            the same reason as `socket/document.ts` — see `isRoomEmpty`.
 */
import { Server, Socket } from "socket.io";
import { prisma } from "@nimbus/db";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createRateLimiter } from "../lib/rateLimiter";
import { extractCanvasText } from "../lib/documentText";
import { presenceColor } from "@nimbus/utils";
import { isRoomEmpty } from "./roomState";

/** Full element array for one canvas (replaced, never merged). */
type CanvasState = readonly OrderedExcalidrawElement[];

/** In-memory canvas states keyed by document id. */
export const canvases = new Map<string, CanvasState>();

/** Pending debounced persist timers, keyed by document id. */
const saveTimers = new Map<string, NodeJS.Timeout>();

const CANVAS_ROOM = (canvasId: string) => `canvas:${canvasId}`;

/** Pointer events one socket may send per second; clients send about 20. */
const POINTERS_PER_SECOND = 60;
/** Selected ids relayed with one pointer; a larger selection is cut short. */
const MAX_SELECTED_IDS = 200;
const MAX_ID_LENGTH = 64;

type PointerPayload = {
  canvasId: string;
  x: number;
  y: number;
  tool?: "pointer" | "laser";
  button?: "up" | "down";
  selectedElementIds?: string[];
};

/**
 * Narrows an untrusted pointer payload to the fields that are relayed.
 *
 * @returns The cleaned pointer, or `null` when it is not a well-formed one.
 */
const parsePointer = (
  data: unknown,
): Omit<PointerPayload, "canvasId"> | null => {
  if (typeof data !== "object" || data === null) return null;
  const { x, y, tool, button, selectedElementIds } = data as Record<
    string,
    unknown
  >;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (tool !== undefined && tool !== "pointer" && tool !== "laser") return null;
  if (button !== undefined && button !== "up" && button !== "down") return null;
  if (selectedElementIds !== undefined && !Array.isArray(selectedElementIds)) {
    return null;
  }

  return {
    x,
    y,
    ...(tool ? { tool } : {}),
    ...(button ? { button } : {}),
    ...(selectedElementIds
      ? {
          selectedElementIds: selectedElementIds
            .filter(
              (id): id is string =>
                typeof id === "string" && id.length <= MAX_ID_LENGTH,
            )
            .slice(0, MAX_SELECTED_IDS),
        }
      : {}),
  };
};

/** Loads (or lazily hydrates) the element array for a canvas id. */
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

/** Persists the current in-memory element array. */
const saveSnapshot = async (canvasId: string) => {
  const elements = canvases.get(canvasId);
  if (!elements) return;

  try {
    await prisma.document.update({
      where: { id: canvasId },
      data: {
        canvasData: elements,
        searchText: extractCanvasText(elements) || null,
      },
    });

    console.log("canvas snapshot saved:", canvasId);
  } catch (error) {
    // A canvas deleted mid-session has no row to update; the debounce timer
    // would otherwise surface this as an unhandled rejection.
    console.error("Error saving canvas snapshot:", error);
  }
};

/**
 * Drops every trace of a canvas from process memory.
 *
 * Exported so document deletion can evict without leaving a pending debounce
 * that would re-persist a deleted row.
 *
 * @param canvasId - Canvas document to evict.
 */
export const evictCanvas = (canvasId: string) => {
  const timer = saveTimers.get(canvasId);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(canvasId);
  }
  canvases.delete(canvasId);
};

/**
 * Writes a pending debounced save now, so a read of the row sees the live
 * canvas. Does nothing when no save is pending.
 *
 * @param canvasId - Canvas document to flush.
 */
export const flushCanvas = async (canvasId: string) => {
  const timer = saveTimers.get(canvasId);
  if (!timer) return;
  clearTimeout(timer);
  saveTimers.delete(canvasId);
  await saveSnapshot(canvasId);
};

/** Resets the 3s persist timer — drag bursts collapse into one DB write. */
const debouncedSave = (canvasId: string) => {
  if (saveTimers.has(canvasId)) clearTimeout(saveTimers.get(canvasId)!);

  const timer = setTimeout(() => {
    saveSnapshot(canvasId);
    saveTimers.delete(canvasId);
  }, 3000);

  saveTimers.set(canvasId, timer);
};

/**
 * Registers canvas handlers for one socket.
 *
 * `canvas:join` membership-gates and replays full state; `canvas:update`
 * requires room membership, drops empty-overwrite races, then relays +
 * debounce-saves; `canvas:pointer` relays a stamped pointer to the room;
 * `canvas:leave` / `disconnecting` announce the pointer gone, then snapshot +
 * evict when the room drains.
 */
export const registerCanvasHandlers = (io: Server, socket: Socket) => {
  const user = socket.data.user;
  const withinPointerBudget = createRateLimiter(POINTERS_PER_SECOND, 1000);

  /** Tells the room this socket's pointer is gone. */
  const announcePointerGone = (canvasId: string) => {
    socket
      .to(CANVAS_ROOM(canvasId))
      .emit("canvas:pointer-leave", { canvasId, socketId: socket.id });
  };

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
      initialized,
    }: {
      documentId: string;
      elements: CanvasState;
      initialized?: boolean;
    }) => {
      try {
        // Guard: only room members may write — prevents stray updates from
        // sockets that never joined (or already left) from forking state.
        if (!socket.rooms.has(CANVAS_ROOM(documentId))) {
          return socket.emit("canvas:error", "Not joined to canvas");
        }

        // An empty array from a sender that has not applied the authoritative
        // state means "I have not loaded yet", not "I cleared the canvas" —
        // dropping it avoids wiping peers' work. The flag, rather than the
        // array's length, is what makes an intentional clear expressible: a
        // loaded client sending `[]` really did delete everything.
        if (elements.length === 0 && initialized !== true) {
          return;
        }

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

  socket.on("canvas:pointer", (data: PointerPayload) => {
    try {
      const canvasId = data?.canvasId;
      // Same room gate as `canvas:update`.
      if (
        typeof canvasId !== "string" ||
        !socket.rooms.has(CANVAS_ROOM(canvasId))
      ) {
        return socket.emit("canvas:error", "Not joined to canvas");
      }

      // A burst over budget is dropped: the next pointer supersedes it.
      if (!withinPointerBudget()) return;

      const pointer = parsePointer(data);
      if (!pointer) return;

      socket.to(CANVAS_ROOM(canvasId)).emit("canvas:pointer", {
        canvasId,
        socketId: socket.id,
        user: {
          userId: user.id,
          name: user.name,
          color: presenceColor(user.id),
          image: user.image ?? null,
        },
        ...pointer,
      });
    } catch (error) {
      console.error("Error relaying pointer:", error);
      socket.emit("canvas:error", "Something went wrong");
    }
  });

  socket.on("canvas:leave", async (canvasId: string) => {
    try {
      if (socket.rooms.has(CANVAS_ROOM(canvasId)))
        announcePointerGone(canvasId);
      socket.leave(CANVAS_ROOM(canvasId));
      const room = CANVAS_ROOM(canvasId);

      if (isRoomEmpty(io, room, socket)) {
        await saveSnapshot(canvasId);

        if (isRoomEmpty(io, room, socket)) {
          evictCanvas(canvasId);
          console.log("canvas removed from memory:", canvasId);
        }
      }
    } catch (error) {
      console.error("Error leaving canvas:", error);
      socket.emit("canvas:error", "Something went wrong");
    }
  });

  socket.on("disconnecting", async () => {
    try {
      // Synchronous and first, so a slow snapshot never keeps a ghost pointer.
      for (const room of socket.rooms) {
        if (room.startsWith("canvas:")) announcePointerGone(room.slice(7));
      }

      for (const room of socket.rooms) {
        if (!room.startsWith("canvas:")) continue;

        const canvasId = room.replace("canvas:", "");

        if (!isRoomEmpty(io, room, socket)) continue;

        await saveSnapshot(canvasId);

        if (isRoomEmpty(io, room, socket)) {
          evictCanvas(canvasId);
          console.log("canvas saved & cleaned:", canvasId);
        }
      }
    } catch (error) {
      console.error("disconnect error:", error);
    }
  });
};
