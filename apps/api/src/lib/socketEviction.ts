/**
 * @module api/lib/socketEviction
 * @description Taking a user's live sockets out of a workspace's rooms when
 * their membership ends: the workspace room (chat, presence, meeting captions,
 * document announcements) and every document and canvas room of that workspace.
 *
 * Socket handlers re-check membership on each event, but a socket that only
 * listens never sends one, so ending the membership row alone leaves it
 * receiving everything broadcast to the rooms it already joined.
 *
 * @important For a socket on this process the document and canvas rooms are
 *            left by running the socket's own `doc:leave` / `canvas:leave`
 *            handlers, so cursor cleanup, the final snapshot and in-memory
 *            eviction behave exactly as for a client that left by itself. A
 *            socket held by another replica (reached through the Redis
 *            adapter) can only be taken out of its rooms, not run through
 *            those handlers.
 *
 * @important Eviction is best effort and runs after the membership row is gone.
 *            A failure is logged and never fails the request that removed the
 *            member; the per-event membership checks still refuse anything the
 *            evicted socket then tries to do.
 */
import { prisma } from "@nimbus/db";
import type { Server } from "socket.io";
import { presenceService } from "./presence";

/** The slice of Socket.IO the eviction uses. */
export type EvictionServer = Pick<Server, "fetchSockets" | "to" | "sockets">;

const LEAVE_EVENTS = [
  { prefix: "doc:", event: "doc:leave" },
  { prefix: "canvas:", event: "canvas:leave" },
] as const;

/**
 * Removes every socket of a user from a workspace's rooms.
 *
 * @param io - The Socket.IO server.
 * @param workspaceId - The workspace the user is no longer part of.
 * @param userId - The user whose sockets to evict.
 */
export async function evictUserFromWorkspace(
  io: EvictionServer,
  workspaceId: string,
  userId: string,
): Promise<void> {
  try {
    const [documents, sockets] = await Promise.all([
      prisma.document.findMany({
        where: { workspaceId },
        select: { id: true },
      }),
      io.fetchSockets(),
    ]);
    const documentIds = new Set(documents.map((d) => d.id));

    let wasPresent = false;
    for (const remote of sockets) {
      const user = (remote.data as { user?: { id?: string } } | undefined)
        ?.user;
      if (user?.id !== userId) continue;

      if (remote.rooms.has(workspaceId)) {
        wasPresent = true;
        remote.leave(workspaceId);
      }

      const local = io.sockets.sockets.get(remote.id);
      for (const room of [...remote.rooms]) {
        for (const { prefix, event } of LEAVE_EVENTS) {
          if (!room.startsWith(prefix)) continue;
          if (!documentIds.has(room.slice(prefix.length))) continue;
          if (local) {
            await Promise.all(
              local
                .listeners(event)
                .map((listener) =>
                  Promise.resolve(
                    (listener as (id: string) => unknown)(
                      room.slice(prefix.length),
                    ),
                  ),
                ),
            );
          } else {
            remote.leave(room);
          }
        }
      }
    }

    if (wasPresent) {
      await presenceService.userLeft(workspaceId, userId);
      io.to(workspaceId).emit("presence:left", { userId });
    }
  } catch (error) {
    console.error(
      "[workspace] could not evict the sockets of a removed member:",
      error instanceof Error ? error.name : "unknown error",
    );
  }
}
