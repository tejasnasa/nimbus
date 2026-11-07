/**
 * @module api/__tests__/integration/http/livekitWebhook
 * @description The media server's webhook: signature verification, content-type
 * handling, idempotency, and the roster it maintains and broadcasts.
 *
 * Deliveries are signed exactly as the media server signs them (a JWT carrying
 * the body's SHA-256), against a real app with a real Socket.IO server, so the
 * raw-body mount, Redis and the `voice:roster` fan-out all run for real.
 */
import type { Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { roomNameFor } from "../../../lib/livekit/rooms";
import { pubClient } from "../../../lib/redis";
import { voicePresenceService } from "../../../lib/voicePresence";
import {
  addMember,
  closeTestResources,
  connectClient,
  createWorkspace,
  mintUser,
  resetDatabase,
  signWebhook,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
  type WebhookFixture,
} from "@testhelpers";
import { createApp } from "../../../app";

type Roster = { users: Array<{ userId: string; name: string; image: string | null }> };

const WEBHOOK_TYPE = "application/webhook+json";
const app = createApp();
const sockets: ClientSocket[] = [];

describe("http: livekit webhook", () => {
  let server: TestServer;
  let owner: TestUser;
  let member: TestUser;
  let workspaceId: string;

  const deliver = async (
    fixture: WebhookFixture,
    options: { secret?: string } = {},
  ) => {
    const { body, authorization } = await signWebhook(fixture, options.secret);
    return request(server.url)
      .post("/api/livekit/webhook")
      .set("Content-Type", WEBHOOK_TYPE)
      .set("Authorization", authorization)
      .send(body);
  };

  const joined = (
    identity: string,
    extra: Partial<WebhookFixture> = {},
  ): WebhookFixture => ({
    event: "participant_joined",
    room: { name: roomNameFor(workspaceId) },
    participant: {
      identity,
      name: `Name of ${identity}`,
      metadata: JSON.stringify({ image: "https://img.test/x.png" }),
    },
    ...extra,
  });

  const openSocket = async (user: TestUser) => {
    const socket = connectClient(server.url, { Cookie: user.cookie });
    await waitForEvent(socket, "connect");
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await closeTestResources();
  });

  beforeEach(async () => {
    await resetDatabase();
    owner = await mintUser(app, { name: "Olive Owner" });
    member = await mintUser(app, { name: "Mia Member" });
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, member.id, "MEMBER");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  describe("verification", () => {
    it("accepts a delivery signed with the project secret", async () => {
      const res = await deliver(joined(owner.id));

      expect(res.status).toBe(200);
      expect(res.text).toBe("");
    });

    it("answers a forged signature with a bare 401 and changes nothing", async () => {
      const res = await deliver(joined(owner.id), { secret: "not-the-secret" });

      expect(res.status).toBe(401);
      expect(res.text).toBe("");
      await expect(voicePresenceService.getUsers(workspaceId)).resolves.toEqual(
        [],
      );
    });

    it("rejects a body that does not match the signed digest", async () => {
      const { authorization } = await signWebhook(joined(owner.id));
      const other = await signWebhook(joined(member.id));

      const res = await request(server.url)
        .post("/api/livekit/webhook")
        .set("Content-Type", WEBHOOK_TYPE)
        .set("Authorization", authorization)
        .send(other.body);

      expect(res.status).toBe(401);
      await expect(voicePresenceService.getUsers(workspaceId)).resolves.toEqual(
        [],
      );
    });

    it("rejects an unsigned delivery", async () => {
      const { body } = await signWebhook(joined(owner.id));

      const res = await request(server.url)
        .post("/api/livekit/webhook")
        .set("Content-Type", WEBHOOK_TYPE)
        .send(body);

      expect(res.status).toBe(401);
      expect(res.text).toBe("");
    });

    it("rejects a delivery that is not sent as a webhook", async () => {
      const { body, authorization } = await signWebhook(joined(owner.id));

      const res = await request(server.url)
        .post("/api/livekit/webhook")
        .set("Content-Type", "application/json")
        .set("Authorization", authorization)
        .send(body);

      expect(res.status).toBe(415);
      await expect(voicePresenceService.getUsers(workspaceId)).resolves.toEqual(
        [],
      );
    });

    it("does not need a session", async () => {
      // No cookie anywhere in `deliver`: the signature is the authentication.
      const res = await deliver(joined(owner.id));

      expect(res.status).toBe(200);
    });
  });

  describe("idempotency", () => {
    it("ignores a repeated event id", async () => {
      const first = joined(owner.id, { id: "EV_repeat" });
      await deliver(first);
      await voicePresenceService.removeUser(workspaceId, owner.id);

      const res = await deliver(first);

      expect(res.status).toBe(200);
      await expect(voicePresenceService.getUsers(workspaceId)).resolves.toEqual(
        [],
      );
    });

    it("remembers the id for at most an hour", async () => {
      await deliver(joined(owner.id, { id: "EV_ttl" }));

      const ttl = await pubClient.ttl("webhook:EV_ttl");
      expect(ttl).toBeGreaterThan(3500);
      expect(ttl).toBeLessThanOrEqual(3600);
    });

    it("processes distinct ids independently", async () => {
      await deliver(joined(owner.id, { id: "EV_a" }));
      await deliver(joined(member.id, { id: "EV_b" }));

      const users = await voicePresenceService.getUsers(workspaceId);
      expect(users.map((u) => u.userId).sort()).toEqual(
        [owner.id, member.id].sort(),
      );
    });

    it("releases the claim when handling fails, so the retry is processed", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(voicePresenceService, "addUser").mockRejectedValueOnce(
        new Error("redis hiccup"),
      );
      const event = joined(owner.id, { id: "EV_retry" });

      const failed = await deliver(event);
      expect(failed.status).toBe(500);

      const retried = await deliver(event);
      expect(retried.status).toBe(200);
      await expect(voicePresenceService.getUsers(workspaceId)).resolves.toHaveLength(
        1,
      );
    });
  });

  describe("roster", () => {
    it("adds a human on participant_joined, with name and avatar", async () => {
      await deliver(joined(owner.id));

      await expect(voicePresenceService.getUsers(workspaceId)).resolves.toEqual([
        {
          userId: owner.id,
          name: `Name of ${owner.id}`,
          image: "https://img.test/x.png",
        },
      ]);
    });

    it("stores no mute state", async () => {
      await deliver(joined(owner.id));

      const [stored] = await voicePresenceService.getUsers(workspaceId);
      expect(stored).not.toHaveProperty("isMuted");
    });

    it("removes a human on participant_left", async () => {
      await deliver(joined(owner.id));
      await deliver({ ...joined(owner.id), event: "participant_left" });

      await expect(voicePresenceService.getUsers(workspaceId)).resolves.toEqual(
        [],
      );
    });

    it("empties the roster on room_finished", async () => {
      await deliver(joined(owner.id));
      await deliver(joined(member.id));
      await deliver({
        event: "room_finished",
        room: { name: roomNameFor(workspaceId) },
      });

      await expect(voicePresenceService.getUsers(workspaceId)).resolves.toEqual(
        [],
      );
    });

    it("keeps an agent participant out of the human roster", async () => {
      await deliver(joined("agent-AJ_123"));
      await deliver({
        ...joined("nimbus"),
        participant: { identity: "nimbus", name: "Nimbus", kind: 4 },
      });

      await expect(voicePresenceService.getUsers(workspaceId)).resolves.toEqual(
        [],
      );
    });

    it("ignores rooms that are not workspace rooms", async () => {
      const res = await deliver({
        ...joined(owner.id),
        room: { name: "someone-elses-room" },
      });

      expect(res.status).toBe(200);
      await expect(voicePresenceService.getUsers(workspaceId)).resolves.toEqual(
        [],
      );
      await expect(pubClient.keys("voice_presence:*")).resolves.toEqual([]);
    });

    it("acknowledges event types it does not use", async () => {
      const res = await deliver({
        event: "track_published",
        room: { name: roomNameFor(workspaceId) },
        participant: { identity: owner.id },
      });

      expect(res.status).toBe(200);
    });

    it("tolerates malformed avatar metadata", async () => {
      await deliver(
        joined(owner.id, {
          participant: { identity: owner.id, name: "O", metadata: "{not json" },
        }),
      );

      const [stored] = await voicePresenceService.getUsers(workspaceId);
      expect(stored?.image).toBeNull();
    });
  });

  describe("broadcast", () => {
    it("emits voice:roster to the workspace on a join and on a leave", async () => {
      const watcher = await openSocket(member);
      watcher.emit("workspace:join", workspaceId);
      await waitForEvent(watcher, "voice:roster"); // the join replay

      const afterJoin = waitForEvent<Roster>(watcher, "voice:roster");
      await deliver(joined(owner.id));
      expect((await afterJoin).users.map((u) => u.userId)).toEqual([owner.id]);

      const afterLeave = waitForEvent<Roster>(watcher, "voice:roster");
      await deliver({ ...joined(owner.id), event: "participant_left" });
      expect((await afterLeave).users).toEqual([]);
    });

    it("does not reach sockets that have not joined the workspace", async () => {
      const bystander = await openSocket(owner);
      const received = vi.fn();
      bystander.on("voice:roster", received);

      await deliver(joined(owner.id));
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(received).not.toHaveBeenCalled();
    });

    it("tells a socket who is on the call when it joins the workspace", async () => {
      await deliver(joined(owner.id));

      const late = await openSocket(member);
      const roster = waitForEvent<Roster>(late, "voice:roster");
      late.emit("workspace:join", workspaceId);

      expect((await roster).users.map((u) => u.userId)).toEqual([owner.id]);
    });

    it("sends an empty roster to a joiner when nobody is on the call", async () => {
      const late = await openSocket(member);
      const roster = waitForEvent<Roster>(late, "voice:roster");
      late.emit("workspace:join", workspaceId);

      expect((await roster).users).toEqual([]);
    });

    it("sends no roster to a non-member who tries to join", async () => {
      const outsider = await mintUser(app);
      const socket = await openSocket(outsider);
      const received = vi.fn();
      socket.on("voice:roster", received);

      const refused = waitForEvent(socket, "workspace:error");
      socket.emit("workspace:join", workspaceId);
      await refused;
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(received).not.toHaveBeenCalled();
    });
  });
});
