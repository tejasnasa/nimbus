/**
 * @module api/lib/voicePresence
 * @description The call roster, backed by a Redis Hash per workspace
 * (`voice_presence:<workspaceId>`, field = userId, value = JSON VoiceUser).
 * Keys carry a 24h TTL as a stale-data guard.
 *
 * @important The roster mirrors the media room and is written only from the
 *            media server's webhooks (`routers/livekitWebhook.router`), never
 *            from a client event, so a client cannot claim a seat it does not
 *            hold. It carries no mute state: that is a property of the
 *            published microphone track, read by clients from the room itself.
 */
import { VoiceUser } from "@nimbus/types";
import { pubClient } from "./redis";

const getKey = (workspaceId: string) => `voice_presence:${workspaceId}`;

/** Hash-based call roster; socket emission lives with the webhook handler. */
export const voicePresenceService = {
  /**
   * Adds (or refreshes) a user's roster entry.
   *
   * @param workspaceId - Workspace whose call it is.
   * @param user - Full VoiceUser payload stored as JSON.
   */
  async addUser(workspaceId: string, user: VoiceUser) {
    const key = getKey(workspaceId);
    await pubClient.hset(key, user.userId, JSON.stringify(user));
    await pubClient.expire(key, 86400);
  },

  /**
   * Removes a user from the roster (no-op when absent).
   *
   * @param workspaceId - Workspace whose call it is.
   * @param userId - User to remove.
   */
  async removeUser(workspaceId: string, userId: string) {
    await pubClient.hdel(getKey(workspaceId), userId);
  },

  /**
   * Empties the roster, as when the media room closes.
   *
   * @param workspaceId - Workspace whose call ended.
   */
  async clear(workspaceId: string) {
    await pubClient.del(getKey(workspaceId));
  },

  /**
   * Reads the full roster.
   *
   * @param workspaceId - Workspace whose call it is.
   * @returns Parsed VoiceUser entries.
   */
  async getUsers(workspaceId: string): Promise<VoiceUser[]> {
    const all = await pubClient.hvals(getKey(workspaceId));
    return all.map((str) => JSON.parse(str) as VoiceUser);
  },
};
