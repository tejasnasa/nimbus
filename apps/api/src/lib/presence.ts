import { pubClient } from "./redis";

const getKey = (workspaceId: string) => `presence:${workspaceId}`;

export const presenceService = {
  async userJoined(workspaceId: string, userId: string) {
    const key = getKey(workspaceId);
    await pubClient.sadd(key, userId);
    await pubClient.expire(key, 86400, "NX");
  },

  async userLeft(workspaceId: string, userId: string) {
    await pubClient.srem(getKey(workspaceId), userId);
  },

  async getOnlineUsers(workspaceId: string) {
    return pubClient.smembers(getKey(workspaceId));
  },
};
