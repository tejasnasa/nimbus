/**
 * @module api/__tests__/integration/socket/canvas
 * @description Canvas collaboration, which is deliberately NOT a CRDT: the full
 * element array is replaced wholesale (last-write-wins) rather than merged.
 *
 * The interesting behaviour is the empty-update guard — an empty array normally
 * means "this client hasn't loaded yet", so it must not wipe the room's work.
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
import { canvases } from "../../../socket/canvas";
import {
  addMember,
  closeTestResources,
  connectClient,
  createDocument,
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

/** Minimal element shapes — the server relays arrays without inspecting them. */
const element = (id: string) => ({ id, type: "rectangle", version: 1 });

const openSockets: ClientSocket[] = [];

const openSocket = async (server: TestServer, user: TestUser) => {
  const socket = connectClient(server.url, { Cookie: user.cookie });
  await waitForEvent(socket, "connect");
  openSockets.push(socket);
  return socket;
};

/** Joins a canvas and resolves with the state the server replayed. */
const joinCanvas = async (socket: ClientSocket, canvasId: string) => {
  const state = waitForEvent<{ elements: unknown[] }>(socket, "canvas:state");
  socket.emit("canvas:join", canvasId);
  return state;
};

describe("socket: canvas", () => {
  let server: TestServer;
  let owner: TestUser;
  let peer: TestUser;
  let wsId: string;
  let canvasId: string;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await closeTestResources();
  });

  afterEach(() => {
    for (const socket of openSockets.splice(0)) socket.close();
    canvases.clear();
  });

  beforeEach(async () => {
    await resetDatabase();
    canvases.clear();

    owner = await mintUser(app);
    peer = await mintUser(app);

    wsId = (await createWorkspace(owner.id)).id;
    await addMember(wsId, peer.id, "MEMBER");
    canvasId = (await createDocument(wsId, { type: "CANVAS" })).id;
  });

  describe("joining", () => {
    it("replays the persisted elements to a member", async () => {
      await testPrisma.document.update({
        where: { id: canvasId },
        data: { canvasData: [element("persisted-1")] },
      });

      const socket = await openSocket(server, owner);
      const state = await joinCanvas(socket, canvasId);

      expect(state.elements).toHaveLength(1);
      expect(state.elements[0]).toMatchObject({ id: "persisted-1" });
    });

    it("replays an empty canvas as an empty array", async () => {
      const socket = await openSocket(server, owner);
      const state = await joinCanvas(socket, canvasId);

      expect(state.elements).toEqual([]);
    });

    it("refuses a non-member", async () => {
      const outsider = await mintUser(app);
      const socket = await openSocket(server, outsider);

      const failure = waitForEvent<string>(socket, "canvas:error");
      socket.emit("canvas:join", canvasId);

      await expect(failure).resolves.toBe("Not a member");
      expect(canvases.has(canvasId)).toBe(false);
    });
  });

  describe("updates", () => {
    it("replaces the room's elements and relays them to other members", async () => {
      const ownerSocket = await openSocket(server, owner);
      await joinCanvas(ownerSocket, canvasId);

      const peerSocket = await openSocket(server, peer);
      await joinCanvas(peerSocket, canvasId);

      const incoming = waitForEvent<{ elements: unknown[] }>(peerSocket, "canvas:update");
      ownerSocket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("drawn-1"), element("drawn-2")],
      });

      const received = await incoming;
      expect(received.elements).toHaveLength(2);
      expect(canvases.get(canvasId)).toHaveLength(2);
    });

    // The guard that matters: an empty array usually means "sender not loaded".
    it("ignores an empty update when the room already has elements", async () => {
      const ownerSocket = await openSocket(server, owner);
      await joinCanvas(ownerSocket, canvasId);

      ownerSocket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("kept")],
      });
      await new Promise((resolve) => setTimeout(resolve, 250));

      const peerSocket = await openSocket(server, peer);
      await joinCanvas(peerSocket, canvasId);

      peerSocket.emit("canvas:update", { documentId: canvasId, elements: [] });
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(canvases.get(canvasId)).toHaveLength(1);
    });

    it("accepts an empty update when the canvas is already empty", async () => {
      const socket = await openSocket(server, owner);
      await joinCanvas(socket, canvasId);

      socket.emit("canvas:update", { documentId: canvasId, elements: [] });
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(canvases.get(canvasId)).toEqual([]);
    });

    it("rejects an update from a socket that never joined", async () => {
      const socket = await openSocket(server, owner);

      const failure = waitForEvent<string>(socket, "canvas:error");
      socket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("forged")],
      });

      await expect(failure).resolves.toBe("Not joined to canvas");
      expect(canvases.has(canvasId)).toBe(false);
    });
  });

  describe("leaving", () => {
    it("persists the elements once the room drains", async () => {
      const socket = await openSocket(server, owner);
      await joinCanvas(socket, canvasId);

      socket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("saved-1")],
      });
      await new Promise((resolve) => setTimeout(resolve, 250));

      socket.emit("canvas:leave", canvasId);
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(canvases.has(canvasId)).toBe(false);

      const stored = await testPrisma.document.findUnique({ where: { id: canvasId } });
      expect(stored?.canvasData).toHaveLength(1);
    });

    it("keeps the canvas in memory while another member remains", async () => {
      const ownerSocket = await openSocket(server, owner);
      await joinCanvas(ownerSocket, canvasId);
      const peerSocket = await openSocket(server, peer);
      await joinCanvas(peerSocket, canvasId);

      ownerSocket.emit("canvas:leave", canvasId);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(canvases.has(canvasId)).toBe(true);
    });
  });
});
