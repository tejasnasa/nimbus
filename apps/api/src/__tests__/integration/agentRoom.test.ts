/**
 * @module api/__tests__/integration/agentRoom
 * @description The room checks the assistant relies on, against the dev media
 * server: counting people (not agents), reading a missing room as empty, and
 * listing live rooms.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countHumans,
  liveRoomNames,
  removeAgents,
} from "../../lib/livekit/agentRoom";
import { roomNameFor } from "../../lib/livekit/rooms";
import {
  closeTestResources,
  createUser,
  createWorkspace,
  joinCall,
  leaveAllCalls,
  resetDatabase,
} from "@testhelpers";

afterAll(closeTestResources);

describe("agent room helpers", () => {
  let workspaceId: string;

  beforeEach(async () => {
    await resetDatabase();
    const user = await createUser("Caller");
    workspaceId = (await createWorkspace(user.id)).id;
  });

  afterEach(leaveAllCalls);

  it("reads a room that does not exist as empty", async () => {
    expect(await countHumans(roomNameFor(workspaceId))).toBe(0);
  });

  it("counts people, and leaves agents out", async () => {
    await joinCall({ id: "human-1", name: "One" }, workspaceId);
    await joinCall({ id: "human-2", name: "Two" }, workspaceId);
    await joinCall({ id: "agent-impostor", name: "Bot" }, workspaceId);

    expect(await countHumans(roomNameFor(workspaceId))).toBe(2);
  });

  it("removes agents from a room and leaves people in it", async () => {
    const human = await joinCall({ id: "human-1", name: "One" }, workspaceId);
    const agent = await joinCall({ id: "agent-impostor", name: "Bot" }, workspaceId);
    const gone = new Promise<void>((resolve) =>
      agent.room.once("disconnected" as never, () => resolve()),
    );

    await removeAgents(roomNameFor(workspaceId));
    await gone;

    expect(await countHumans(roomNameFor(workspaceId))).toBe(1);
    expect(human.room.isConnected).toBe(true);
  });

  it("does nothing when the room is gone", async () => {
    await expect(removeAgents(roomNameFor(workspaceId))).resolves.toBeUndefined();
  });

  it("lists the rooms that exist", async () => {
    await joinCall({ id: "human-1", name: "One" }, workspaceId);

    const rooms = await liveRoomNames();

    expect(rooms.has(roomNameFor(workspaceId))).toBe(true);
    expect(rooms.has("nimbus-ws-nobody")).toBe(false);
  });
});
