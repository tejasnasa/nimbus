/**
 * @module api/__tests__/integration/socket/chat
 * @description Workspace chat, presence, and typing indicators over a real
 * Socket.IO connection.
 *
 * Two genuine clients are used throughout, and assertions are made on what the
 * *other* client receives — never on sender-side side effects, which is the main
 * source of two-client flake.
 */
import type { Socket as ClientSocket } from "socket.io-client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createApp } from "../../../app";
import { presenceService } from "../../../lib/presence";
import {
  addMember,
  closeTestResources,
  connectClient,
  createWorkspace,
  mintUser,
  resetDatabase,
  startTestServer,
  testPrisma,
  waitForEvent,
  type TestServer,
  type TestUser,
} from "@testhelpers";

const app = createApp();

const openSockets: ClientSocket[] = [];

const openSocket = async (server: TestServer, user: TestUser) => {
  const socket = connectClient(server.url, { Cookie: user.cookie });
  await waitForEvent(socket, "connect");
  openSockets.push(socket);
  return socket;
};

describe("socket: chat", () => {
  let server: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let wsId: string;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await closeTestResources();
  });

  afterEach(() => {
    // Abrupt closes are cleaned up by the server's `disconnecting` handler.
    for (const socket of openSockets.splice(0)) socket.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    alice = await mintUser(app);
    bob = await mintUser(app);

    wsId = (await createWorkspace(alice.id)).id;
    await addMember(wsId, bob.id, "MEMBER");
  });

  describe("presence", () => {
    it("ignores a leave from a non-member rather than touching the room", async () => {
      const outsider = await mintUser(app);
      const socket = await openSocket(server, outsider);

      // No event should fire and no error should be raised — the handler is a
      // silent no-op for non-members, mirroring the same drop on `message:send`.
      socket.emit("workspace:leave", wsId);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Roster is untouched.
      await expect(presenceService.getOnlineUsers(wsId)).resolves.toEqual([]);
    });

    it("announces a join to the room and replays the roster to the joiner", async () => {
      const aliceSocket = await openSocket(server, alice);
      aliceSocket.emit("workspace:join", wsId);
      await waitForEvent(aliceSocket, "presence:online_users");

      const bobSocket = await openSocket(server, bob);
      const announcement = waitForEvent<{ userId: string; name: string }>(
        aliceSocket,
        "presence:joined",
      );

      const rosterUpdate = waitForEvent<string[]>(
        bobSocket,
        "presence:online_users",
      );
      bobSocket.emit("workspace:join", wsId);

      await expect(announcement).resolves.toMatchObject({ userId: bob.id });
      await expect(rosterUpdate).resolves.toEqual(
        expect.arrayContaining([alice.id, bob.id]),
      );
    });

    it("records presence in Redis", async () => {
      const socket = await openSocket(server, alice);
      socket.emit("workspace:join", wsId);
      await waitForEvent(socket, "presence:online_users");

      await expect(presenceService.getOnlineUsers(wsId)).resolves.toContain(
        alice.id,
      );
    });

    it("announces a leave and clears presence", async () => {
      const aliceSocket = await openSocket(server, alice);
      aliceSocket.emit("workspace:join", wsId);
      await waitForEvent(aliceSocket, "presence:online_users");

      const bobSocket = await openSocket(server, bob);
      bobSocket.emit("workspace:join", wsId);
      await waitForEvent(bobSocket, "presence:online_users");

      const departure = waitForEvent<{ userId: string }>(
        bobSocket,
        "presence:left",
      );
      aliceSocket.emit("workspace:leave", wsId);

      await expect(departure).resolves.toMatchObject({ userId: alice.id });
      await expect(presenceService.getOnlineUsers(wsId)).resolves.not.toContain(
        alice.id,
      );
    });

    it("clears presence when a socket disconnects abruptly", async () => {
      const socket = await openSocket(server, alice);
      socket.emit("workspace:join", wsId);
      await waitForEvent(socket, "presence:online_users");

      socket.close();
      // Give the server's `disconnecting` handler a beat to run.
      await new Promise((resolve) => setTimeout(resolve, 300));

      await expect(presenceService.getOnlineUsers(wsId)).resolves.not.toContain(
        alice.id,
      );
    });
  });

  describe("messages", () => {
    it("persists a message and broadcasts it to everyone else in the room", async () => {
      const aliceSocket = await openSocket(server, alice);
      aliceSocket.emit("workspace:join", wsId);
      await waitForEvent(aliceSocket, "presence:online_users");

      const bobSocket = await openSocket(server, bob);
      bobSocket.emit("workspace:join", wsId);
      await waitForEvent(bobSocket, "presence:online_users");

      const received = waitForEvent<{
        content: string;
        userId: string;
        name: string;
      }>(bobSocket, "message:new");
      aliceSocket.emit("message:send", {
        workspaceId: wsId,
        content: "hello bob",
      });

      await expect(received).resolves.toMatchObject({
        content: "hello bob",
        userId: alice.id,
        name: alice.name,
      });

      const stored = await testPrisma.message.findFirst({
        where: { workspaceId: wsId },
      });
      expect(stored).toMatchObject({ content: "hello bob", userId: alice.id });
    });

    it("drops a message from a non-member rather than persisting it", async () => {
      const outsider = await mintUser(app);
      const socket = await openSocket(server, outsider);

      socket.emit("message:send", {
        workspaceId: wsId,
        content: "i should not exist",
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      await expect(
        testPrisma.message.count({ where: { workspaceId: wsId } }),
      ).resolves.toBe(0);
    });

    it("relays typing indicators to others but not back to the sender", async () => {
      const aliceSocket = await openSocket(server, alice);
      aliceSocket.emit("workspace:join", wsId);
      await waitForEvent(aliceSocket, "presence:online_users");

      const bobSocket = await openSocket(server, bob);
      bobSocket.emit("workspace:join", wsId);
      await waitForEvent(bobSocket, "presence:online_users");

      const aliceSawOwnTyping: string[] = [];
      aliceSocket.on("typing:start", () => aliceSawOwnTyping.push("self"));

      const relayed = waitForEvent<{ userId: string }>(
        bobSocket,
        "typing:start",
      );
      aliceSocket.emit("typing:start", wsId);

      await expect(relayed).resolves.toMatchObject({ userId: alice.id });
      expect(aliceSawOwnTyping).toEqual([]);
    });

    it("does not persist typing indicators", async () => {
      const socket = await openSocket(server, alice);
      socket.emit("typing:start", wsId);
      socket.emit("typing:stop", wsId);
      await new Promise((resolve) => setTimeout(resolve, 200));

      await expect(testPrisma.message.count()).resolves.toBe(0);
    });
  });
});
