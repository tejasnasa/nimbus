import { pubClient } from "./redis";

const getKey = (workspaceId: string) => `presence:${workspaceId}`;

export const presenceService = {
  async userJoined(workspaceId: string, userId: string) {
    await pubClient.sadd(getKey(workspaceId), userId);
  },

  async userLeft(workspaceId: string, userId: string) {
    await pubClient.srem(getKey(workspaceId), userId);
  },

  async getOnlineUsers(workspaceId: string) {
    return pubClient.smembers(getKey(workspaceId));
  },
};
