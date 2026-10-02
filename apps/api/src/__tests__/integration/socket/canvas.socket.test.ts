/**
 * @module api/__tests__/integration/socket/canvas
 * @description Canvas collaboration, which is deliberately NOT a CRDT: the full
 * element array is replaced wholesale (last-write-wins) rather than merged.
 *
 * The interesting behaviour is the empty-update guard — an empty array normally
 * means "this client hasn't loaded yet", so it must not wipe the room's work.
 */
import { prisma } from "@nimbus/db";
import type { Socket as ClientSocket } from "socket.io-client";
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

    // A database failure during the join must reach the client as an error —
    // the alternative is a socket that looks connected and silently never syncs.
    it("reports a failure when the join cannot reach the database", async () => {
      const socket = await openSocket(server, owner);

      const spy = vi
        .spyOn(prisma.document, "findUnique")
        .mockRejectedValueOnce(new Error("database unavailable"));

      const failure = waitForEvent<string>(socket, "canvas:error");
      socket.emit("canvas:join", canvasId);
      const message = await failure;
      spy.mockRestore();

      expect(message).toBe("Something went wrong");
    });

    it("refuses a canvasId that does not exist", async () => {
      const socket = await openSocket(server, owner);

      const failure = waitForEvent<string>(socket, "canvas:error");
      socket.emit("canvas:join", "clxxxxxxxxxxxxxxxxxxxxxx");

      await expect(failure).resolves.toBe("Canvas not found");
      expect(canvases.has("clxxxxxxxxxxxxxxxxxxxxxx")).toBe(false);
    });
  });

  describe("updates", () => {
    it("replaces the room's elements and relays them to other members", async () => {
      const ownerSocket = await openSocket(server, owner);
      await joinCanvas(ownerSocket, canvasId);

      const peerSocket = await openSocket(server, peer);
      await joinCanvas(peerSocket, canvasId);

      const incoming = waitForEvent<{ elements: unknown[] }>(
        peerSocket,
        "canvas:update",
      );
      ownerSocket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("drawn-1"), element("drawn-2")],
      });

      const received = await incoming;
      expect(received.elements).toHaveLength(2);
      expect(canvases.get(canvasId)).toHaveLength(2);
    });

    // The guard that matters: an empty array from a sender that has not yet
    // applied the authoritative state means "not loaded", not "cleared".
    it("ignores an empty update from a client that has not initialized", async () => {
      const ownerSocket = await openSocket(server, owner);
      await joinCanvas(ownerSocket, canvasId);

      ownerSocket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("kept")],
        initialized: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));

      const peerSocket = await openSocket(server, peer);
      await joinCanvas(peerSocket, canvasId);

      // No `initialized` flag — a joiner that has not rendered the state yet.
      peerSocket.emit("canvas:update", { documentId: canvasId, elements: [] });
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(canvases.get(canvasId)).toHaveLength(1);
    });

    // The capability the length-based guard could not express: a client that
    // *has* loaded and deleted everything really did clear the canvas, and the
    // deletion has to relay and persist rather than silently reverting.
    it("lets an initialized client clear the canvas", async () => {
      const ownerSocket = await openSocket(server, owner);
      await joinCanvas(ownerSocket, canvasId);
      const peerSocket = await openSocket(server, peer);
      await joinCanvas(peerSocket, canvasId);

      ownerSocket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("drawn")],
        initialized: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(canvases.get(canvasId)).toHaveLength(1);

      const cleared = waitForEvent<{ elements: unknown[] }>(
        peerSocket,
        "canvas:update",
      );
      ownerSocket.emit("canvas:update", {
        documentId: canvasId,
        elements: [],
        initialized: true,
      });

      await expect(cleared).resolves.toMatchObject({ elements: [] });
      expect(canvases.get(canvasId)).toEqual([]);
    });

    it("debounces rapid-fire updates into a single 3s save", async () => {
      const socket = await openSocket(server, owner);
      await joinCanvas(socket, canvasId);

      // Three updates inside the debounce window — every emit except the
      // first lands on an existing timer and triggers the `clearTimeout`
      // branch (line 62), which is the line this test is here to cover.
      socket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("first")],
      });
      socket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("second")],
      });
      socket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("third")],
      });
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Only the last value is retained in memory; persistence debounces 3s,
      // so before that fires only the in-memory state should reflect the
      // changes.
      expect(canvases.get(canvasId)).toHaveLength(1);
      expect(canvases.get(canvasId)?.[0]).toMatchObject({ id: "third" });

      // Flush the debounce so a snapshot lands and the test cleans up after
      // itself — persistence is covered by the other suite.
      await new Promise((resolve) => setTimeout(resolve, 3_500));
      const stored = await testPrisma.document.findUnique({
        where: { id: canvasId },
      });
      expect(stored?.canvasData).toHaveLength(1);
    });

    it("leaves an already-empty canvas empty when an uninitialized client reports it", async () => {
      const socket = await openSocket(server, owner);
      await joinCanvas(socket, canvasId);

      // Dropped by the guard, which is a no-op here because joining already
      // seeded the in-memory entry with an empty array.
      socket.emit("canvas:update", { documentId: canvasId, elements: [] });
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(canvases.get(canvasId)).toEqual([]);
    });

    it("reports a malformed payload without crashing the handler", async () => {
      const socket = await openSocket(server, owner);
      await joinCanvas(socket, canvasId);

      const failure = waitForEvent<string>(socket, "canvas:error");
      // No `elements` at all — the guard dereferences `.length` on it.
      socket.emit("canvas:update", { documentId: canvasId } as never);

      await expect(failure).resolves.toBe("Something went wrong");
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

      const stored = await testPrisma.document.findUnique({
        where: { id: canvasId },
      });
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

    // Same eviction race as the document suite: the entry must survive a
    // rejoin that lands inside the leave handler's awaited snapshot.
    it("keeps syncing across an immediate leave/rejoin", async () => {
      const ownerSocket = await openSocket(server, owner);
      await joinCanvas(ownerSocket, canvasId);
      const peerSocket = await openSocket(server, peer);
      await joinCanvas(peerSocket, canvasId);

      ownerSocket.emit("canvas:leave", canvasId);
      const restated = waitForEvent<{ elements: unknown[] }>(
        ownerSocket,
        "canvas:state",
      );
      ownerSocket.emit("canvas:join", canvasId);
      await restated;

      const incoming = waitForEvent<{ elements: unknown[] }>(
        peerSocket,
        "canvas:update",
      );
      ownerSocket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("after-rejoin")],
        initialized: true,
      });

      await expect(incoming).resolves.toMatchObject({
        elements: [expect.objectContaining({ id: "after-rejoin" })],
      });
      expect(canvases.has(canvasId)).toBe(true);
    });

    // A row deleted under a live socket leaves the debounced snapshot with
    // nothing to update. That must be swallowed where the timer fires, not
    // surface later as an unhandled rejection.
    it("survives a snapshot against a row that no longer exists", async () => {
      const socket = await openSocket(server, owner);
      await joinCanvas(socket, canvasId);

      socket.emit("canvas:update", {
        documentId: canvasId,
        elements: [element("orphan")],
        initialized: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));

      await testPrisma.document.delete({ where: { id: canvasId } });

      socket.emit("canvas:leave", canvasId);
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(canvases.has(canvasId)).toBe(false);
    });
  });
});
