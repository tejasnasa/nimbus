/**
 * @module api/__tests__/integration/http/livekitWebhook.meeting
 * @description The media server's webhook as a trigger for ending a meeting:
 * the agent leaving the room, or the room closing, ends the workspace's live
 * meeting; a person leaving does not; and a late delivery about an earlier
 * meeting cannot end a newer one.
 */
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createApp } from "../../../app";
import { roomNameFor } from "../../../lib/livekit/rooms";
import {
  addMember,
  closeTestResources,
  connectClient,
  createMeeting,
  createUser,
  createWorkspace,
  mintUser,
  resetDatabase,
  signWebhook,
  startTestServer,
  testPrisma,
  waitForEvent,
  type TestServer,
  type WebhookFixture,
} from "@testhelpers";

describe("http: livekit webhook ends meetings", () => {
  let server: TestServer;
  let workspaceId: string;
  let meetingId: string;
  let starterId: string;

  const deliver = async (fixture: WebhookFixture) => {
    const { body, authorization } = await signWebhook(fixture);
    return request(server.url)
      .post("/api/livekit/webhook")
      .set("Content-Type", "application/webhook+json")
      .set("Authorization", authorization)
      .send(body);
  };

  const left = (identity: string, extra: Partial<WebhookFixture> = {}): WebhookFixture => ({
    event: "participant_left",
    room: { name: roomNameFor(workspaceId) },
    participant: { identity, name: identity },
    ...extra,
  });

  const row = () => testPrisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await closeTestResources();
  });

  beforeEach(async () => {
    await resetDatabase();
    starterId = (await createUser("Starter")).id;
    workspaceId = (await createWorkspace(starterId)).id;
    meetingId = (await createMeeting(workspaceId, { startedById: starterId })).id;
  });

  it("ends the meeting when the agent's participant leaves", async () => {
    const res = await deliver(left("agent-AJ_xyz"));

    expect(res.status).toBe(200);
    expect(await row()).toMatchObject({ status: "ENDED", endReason: "agent-left" });
  });

  it("recognises an agent by the kind the server reports", async () => {
    await deliver(left("worker-1", { participant: { identity: "worker-1", kind: 4 } }));

    expect(await row()).toMatchObject({ status: "ENDED", endReason: "agent-left" });
  });

  it("does not end the meeting when a person leaves the call", async () => {
    await deliver(left(starterId));

    expect((await row()).status).toBe("LIVE");
  });

  it("ends the meeting when the room closes", async () => {
    await deliver({ event: "room_finished", room: { name: roomNameFor(workspaceId) } });

    expect(await row()).toMatchObject({ status: "ENDED", endReason: "room-finished" });
  });

  it("ignores an agent leaving a room that belongs to no workspace", async () => {
    await deliver(left("agent-AJ_xyz", { room: { name: "someone-elses-room" } }));

    expect((await row()).status).toBe("LIVE");
  });

  it("ignores a late event about an earlier meeting", async () => {
    // The meeting just started; the event is from ten minutes ago.
    const res = await deliver(
      left("agent-AJ_old", { createdAt: Math.floor(Date.now() / 1000) - 600 }),
    );

    expect(res.status).toBe(200);
    expect((await row()).status).toBe("LIVE");
  });

  it("is a no-op when the workspace has no live meeting", async () => {
    await testPrisma.meeting.update({
      where: { id: meetingId },
      data: { status: "ENDED", endedAt: new Date(), endReason: "stopped" },
    });

    const res = await deliver(left("agent-AJ_xyz"));

    expect(res.status).toBe(200);
    expect((await row()).endReason).toBe("stopped");
  });

  it("broadcasts the ending to the workspace", async () => {
    const member = await mintUser(createApp(), { name: "Watcher" });
    await addMember(workspaceId, member.id, "MEMBER");
    const socket = connectClient(server.url, { Cookie: member.cookie });
    try {
      await waitForEvent(socket, "connect");
      socket.emit("workspace:join", workspaceId);
      await waitForEvent(socket, "presence:online_users");
      const ended = waitForEvent<{ meetingId: string; reason: string }>(socket, "meeting:ended");

      await deliver(left("agent-AJ_xyz"));

      expect(await ended).toEqual({ meetingId, reason: "agent-left" });
    } finally {
      socket.close();
    }
  });
});
