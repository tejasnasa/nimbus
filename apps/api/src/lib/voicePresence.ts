import { VoiceUser } from "@nimbus/types";
import { pubClient } from "./redis";

const getKey = (workspaceId: string) => `voice_presence:${workspaceId}`;

export const voicePresenceService = {
  async userJoined(workspaceId: string, user: VoiceUser) {
    const key = getKey(workspaceId);
    await pubClient.hset(key, user.userId, JSON.stringify(user));
    await pubClient.expire(key, 86400);
  },

  async userLeft(workspaceId: string, userId: string) {
    await pubClient.hdel(getKey(workspaceId), userId);
  },

  async updateMuteState(workspaceId: string, userId: string, isMuted: boolean) {
    const key = getKey(workspaceId);
    const existing = await pubClient.hget(key, userId);
    if (existing) {
      const user = JSON.parse(existing) as VoiceUser;
      user.isMuted = isMuted;
      await pubClient.hset(key, userId, JSON.stringify(user));
    }
  },

  async getVoiceUsers(workspaceId: string): Promise<VoiceUser[]> {
    const key = getKey(workspaceId);
    const all = await pubClient.hvals(key);
    return all.map((str) => JSON.parse(str) as VoiceUser);
  },
};
