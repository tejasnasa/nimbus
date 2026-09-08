/**
 * @module api/lib/voicePresence
 * @description Voice-channel membership backed by a Redis Hash per workspace
 * (`voice_presence:<workspaceId>`, field = userId, value = JSON VoiceUser).
 * Hashes give O(1) per-user mute updates without rewriting the roster, unlike
 * the Set-based chat presence. Keys carry a 24h TTL as a stale-data guard.
 */
import { VoiceUser } from "@nimbus/types";
import { pubClient } from "./redis";

const getKey = (workspaceId: string) => `voice_presence:${workspaceId}`;

/** Hash-based voice roster; socket emission lives in `socket/voice.ts`. */
export const voicePresenceService = {
  /**
   * Joins (or refreshes) a user's voice entry.
   *
   * @param workspaceId - Workspace voice channel.
   * @param user - Full VoiceUser payload stored as JSON.
   */
  async userJoined(workspaceId: string, user: VoiceUser) {
  async userJoined(workspaceId: string, user: VoiceUser) {
    const key = getKey(workspaceId);
    await pubClient.hset(key, user.userId, JSON.stringify(user));
    await pubClient.expire(key, 86400);
  },

  /**
   * Removes a user from the voice roster (no-op when absent).
   *
   * @param workspaceId - Workspace voice channel.
   * @param userId - User to remove.
   */
  async userLeft(workspaceId: string, userId: string) {
    await pubClient.hdel(getKey(workspaceId), userId);
  },

  /**
   * Patches only the mute flag, preserving the rest of the stored payload.
   *
   * @param workspaceId - Workspace voice channel.
   * @param userId - User whose mute state changed.
   * @param isMuted - New mute state.
   */
  async updateMuteState(workspaceId: string, userId: string, isMuted: boolean) {
    const key = getKey(workspaceId);
    const existing = await pubClient.hget(key, userId);
    if (existing) {
      const user = JSON.parse(existing) as VoiceUser;
      user.isMuted = isMuted;
      await pubClient.hset(key, userId, JSON.stringify(user));
    }
  },

  /**
   * Reads the full voice roster.
   *
   * @param workspaceId - Workspace voice channel.
   * @returns Parsed VoiceUser entries.
   */
  async getVoiceUsers(workspaceId: string): Promise<VoiceUser[]> {
    const key = getKey(workspaceId);
    const all = await pubClient.hvals(key);
    return all.map((str) => JSON.parse(str) as VoiceUser);
  },
};
