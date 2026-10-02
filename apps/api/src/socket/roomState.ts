/**
 * @module api/socket/roomState
 * @description Room-membership predicate shared by the document and canvas
 * sync modules.
 *
 * The two modules must agree on when a room has drained, because both use it to
 * decide whether in-memory state may be evicted. They previously each inlined
 * the check, which is how they drifted: `doc:leave` evicted after an awaited
 * snapshot while the canvas version did the same thing with different
 * consequences.
 */
import type { Server, Socket } from "socket.io";

/**
 * Whether a room holds no participant other than the given socket.
 *
 * `disconnecting` fires while the departing socket is still listed in its own
 * rooms, so a plain size check would either leak the entry (the leaver counted
 * as 1) or, after an awaited save, misread the room. Discounting the caller
 * covers both that case and the already-left case in one predicate.
 *
 * @param io - Server whose adapter holds the room registry.
 * @param room - Room name to inspect.
 * @param socket - The socket that is on its way out.
 * @returns `true` when nobody but `socket` remains in `room`.
 */
export const isRoomEmpty = (io: Server, room: string, socket: Socket) => {
  const sockets = io.sockets.adapter.rooms.get(room);
  if (!sockets || sockets.size === 0) return true;
  return sockets.size === 1 && sockets.has(socket.id);
};
