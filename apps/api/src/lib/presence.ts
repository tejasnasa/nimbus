/**
 * @module api/lib/presence
 * @description Workspace online-presence backed by a Redis Set per workspace
 * (`presence:<workspaceId>`). `sadd`/`srem` make join/leave idempotent, so
 * duplicate socket joins never double-count. Keys get a 24h TTL (NX) as a
 * stale-data guard — normal leaves remove members explicitly.
 */
import { pubClient } from "./redis";

const getKey = (workspaceId: string) => `presence:${workspaceId}`;

/** Set-based presence service; emits no socket events itself (see `socket/chat.ts`). */
export const presenceService = {
  /**
   * Adds a user to the workspace presence set.
   *
   * @param workspaceId - Workspace room identifier.
   * @param userId - User to mark online.
   */
  async userJoined(workspaceId: string, userId: string) {
  async userJoined(workspaceId: string, userId: string) {
    const key = getKey(workspaceId);
    await pubClient.sadd(key, userId);
    await pubClient.expire(key, 86400, "NX");
  },

  /**
   * Removes a user from the presence set.
   *
   * @param workspaceId - Workspace room identifier.
   * @param userId - User to mark offline.
   */
  async userLeft(workspaceId: string, userId: string) {
    await pubClient.srem(getKey(workspaceId), userId);
  },

  /**
   * Lists currently online user IDs.
   *
   * @param workspaceId - Workspace room identifier.
   * @returns Array of user IDs in the presence set.
   */
  async getOnlineUsers(workspaceId: string) {
    return pubClient.smembers(getKey(workspaceId));
  },
};
