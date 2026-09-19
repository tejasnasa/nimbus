/**
 * @module api/__tests__/unit/presence
 * @description Workspace presence as a unit, with `ioredis` swapped for
 * `ioredis-mock` so no server is required. Real Redis gets exercised in the
 * socket integration suite instead.
 *
 * The service is deliberately set-based: `sadd`/`srem` make join and leave
 * idempotent, which is what stops a duplicate socket connection (or a double
 * `workspace:join`) from double-counting a user as online.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ioredis", async () => {
  const { default: RedisMock } = await import("ioredis-mock");
  return { default: RedisMock };
});

import { presenceService } from "../../lib/presence";
import { pubClient } from "../../lib/redis";

const WS_A = "workspace-a";
const WS_B = "workspace-b";

describe("lib/presence", () => {
  beforeEach(async () => {
    await pubClient.flushall();
  });

  it("marks a joined user as online", async () => {
    await presenceService.userJoined(WS_A, "user-1");

    await expect(presenceService.getOnlineUsers(WS_A)).resolves.toEqual(["user-1"]);
  });

  it("is idempotent — joining twice does not duplicate the user", async () => {
    await presenceService.userJoined(WS_A, "user-1");
    await presenceService.userJoined(WS_A, "user-1");

    await expect(presenceService.getOnlineUsers(WS_A)).resolves.toEqual(["user-1"]);
  });

  it("lists every online user in the workspace", async () => {
    await presenceService.userJoined(WS_A, "user-1");
    await presenceService.userJoined(WS_A, "user-2");

    const online = await presenceService.getOnlineUsers(WS_A);
    expect(online.sort()).toEqual(["user-1", "user-2"]);
  });

  it("removes a user on leave", async () => {
    await presenceService.userJoined(WS_A, "user-1");
    await presenceService.userJoined(WS_A, "user-2");

    await presenceService.userLeft(WS_A, "user-1");

    await expect(presenceService.getOnlineUsers(WS_A)).resolves.toEqual(["user-2"]);
  });

  it("treats leaving while absent as a no-op", async () => {
    await presenceService.userLeft(WS_A, "never-joined");

    await expect(presenceService.getOnlineUsers(WS_A)).resolves.toEqual([]);
  });

  it("keeps workspaces isolated from one another", async () => {
    await presenceService.userJoined(WS_A, "user-1");
    await presenceService.userJoined(WS_B, "user-2");

    await expect(presenceService.getOnlineUsers(WS_A)).resolves.toEqual(["user-1"]);
    await expect(presenceService.getOnlineUsers(WS_B)).resolves.toEqual(["user-2"]);

    await presenceService.userLeft(WS_A, "user-1");
    await expect(presenceService.getOnlineUsers(WS_B)).resolves.toEqual(["user-2"]);
  });

  it("gives the workspace key a TTL as a stale-data guard", async () => {
    await presenceService.userJoined(WS_A, "user-1");

    const ttl = await pubClient.ttl(`presence:${WS_A}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86_400);
  });
});
