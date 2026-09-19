/**
 * @module api/__tests__/integration/socket/redis-adapter
 * @description Verifies the horizontal-scaling claim rather than assuming it:
 * two independent server instances sharing the test Redis must deliver a room
 * broadcast to a client connected to the *other* instance.
 *
 * Without the `@socket.io/redis-adapter` wired up, this is the test that fails —
 * rooms and broadcasts would be process-local.
 *
 * @important Only *broadcast* state crosses instances. The per-document Yjs
 *            `docs` map and the canvas `canvases` map are process-local, so a
 *            second instance serves stale document state. That is deliberately
 *            not asserted as passing here — see the note at the end.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import type { Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../../../app";
import {
  addMember,
  closeTestResources,
  connectClient,
  createMessage,
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

describe("socket: redis adapter (multi-instance)", () => {
  let instanceA: TestServer;
  let instanceB: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let wsId: string;

  beforeAll(async () => {
    instanceA = await startTestServer();
    instanceB = await startTestServer();
  });

  afterAll(async () => {
    await instanceA.close();
    await instanceB.close();
    await closeTestResources();
  });

  afterEach(() => {
    for (const socket of openSockets.splice(0)) socket.close();
  });

  beforeEach(async () => {
    await resetDatabase();

    alice = await mintUser(app);
    bob = await mintUser(app);

    wsId = (await createWorkspace(alice.id)).id;
    await addMember(wsId, bob.id, "MEMBER");
  });

  it("delivers a room broadcast from one instance to a client on another", async () => {
    const aliceSocket = await openSocket(instanceA, alice);
    aliceSocket.emit("workspace:join", wsId);
    await waitForEvent(aliceSocket, "presence:online_users");

    // Bob is connected to a *different* process-level server instance.
    const bobSocket = await openSocket(instanceB, bob);
    bobSocket.emit("workspace:join", wsId);
    await waitForEvent(bobSocket, "presence:online_users");

    const delivered = waitForEvent<{ content: string }>(bobSocket, "message:new");
    aliceSocket.emit("message:send", { workspaceId: wsId, content: "across instances" });

    await expect(delivered).resolves.toMatchObject({ content: "across instances" });
    await expect(
      testPrisma.message.count({ where: { workspaceId: wsId } }),
    ).resolves.toBe(1);
  });

  it("propagates presence across instances", async () => {
    const aliceSocket = await openSocket(instanceA, alice);
    aliceSocket.emit("workspace:join", wsId);
    await waitForEvent(aliceSocket, "presence:online_users");

    // Instance B should report the roster Redis holds, including A's user.
    const bobSocket = await openSocket(instanceB, bob);
    const roster = waitForEvent<string[]>(bobSocket, "presence:online_users");
    bobSocket.emit("workspace:join", wsId);

    await expect(roster).resolves.toEqual(expect.arrayContaining([alice.id, bob.id]));
  });

  it("keeps room membership isolated between instances", async () => {
    const aliceSocket = await openSocket(instanceA, alice);
    aliceSocket.emit("workspace:join", wsId);
    await waitForEvent(aliceSocket, "presence:online_users");

    // A socket on instance B that never joins must not receive room broadcasts.
    const stranger = await mintUser(app);
    await addMember(wsId, stranger.id, "MEMBER");
    const strangerSocket = await openSocket(instanceB, stranger);

    const leaked: unknown[] = [];
    strangerSocket.on("message:new", (payload) => leaked.push(payload));

    aliceSocket.emit("message:send", { workspaceId: wsId, content: "room only" });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(leaked).toEqual([]);
  });

  /**
   * Documented limitation, asserted as current behaviour.
   *
   * Each instance hydrates documents into its own in-memory `docs` map, so a
   * client on instance B joins a document that instance A has been editing and
   * receives only what is in Postgres — not instance A's unflushed edits. The
   * Redis adapter does not carry Yjs state.
   *
   * Written as a passing test that pins the *gap*, so the day sticky sessions or
   * a shared Yjs store land, this test fails and forces a conscious update.
   */
  it("does not share in-progress document state between instances", async () => {
    const owner = await mintUser(app);
    const docsWs = await createWorkspace(owner.id);
    const doc = await testPrisma.document.create({
      data: { title: "Instance-local", type: "MARKDOWN", workspaceId: docsWs.id },
    });

    const aliceSocket = await openSocket(instanceA, owner);
    const stateOnA = waitForEvent<number[]>(aliceSocket, "doc:state");
    aliceSocket.emit("doc:join", doc.id);
    await stateOnA;

    // Instance A holds the doc in memory but has not flushed anything to Postgres.
    const bobSocket = await openSocket(instanceB, owner);
    const stateOnB = waitForEvent<number[]>(bobSocket, "doc:state");
    bobSocket.emit("doc:join", doc.id);

    await expect(stateOnB).resolves.toEqual(expect.any(Array));

    const stored = await testPrisma.document.findUnique({ where: { id: doc.id } });
    expect(stored?.yjsState).toBeNull();
  });
});
