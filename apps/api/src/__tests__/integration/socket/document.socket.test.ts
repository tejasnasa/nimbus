/**
 * @module api/__tests__/integration/socket/document
 * @description Server-side Yjs document collaboration: hydration from Postgres,
 * binary update relay, the one-shot AI seed, and the snapshot-on-drain lifecycle.
 *
 * The client side is simulated with a local `Y.Doc` that applies the same
 * updates, which is what a real browser does.
 */
import type { Socket as ClientSocket } from "socket.io-client";
import * as Y from "yjs";
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
import { docs } from "../../../socket/document";
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

const openSockets: ClientSocket[] = [];

const openSocket = async (server: TestServer, user: TestUser) => {
  const socket = connectClient(server.url, { Cookie: user.cookie });
  await waitForEvent(socket, "connect");
  openSockets.push(socket);
  return socket;
};

/** Joins a doc and returns a local Y.Doc hydrated from the server's state. */
const joinDoc = async (socket: ClientSocket, docId: string) => {
  const state = waitForEvent<number[]>(socket, "doc:state");
  socket.emit("doc:join", docId);

  const local = new Y.Doc();
  Y.applyUpdate(local, Uint8Array.from(await state));
  return local;
};

describe("socket: document", () => {
  let server: TestServer;
  let owner: TestUser;
  let peer: TestUser;
  let wsId: string;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await closeTestResources();
  });

  afterEach(() => {
    for (const socket of openSockets.splice(0)) socket.close();
    docs.clear();
  });

  beforeEach(async () => {
    await resetDatabase();
    docs.clear();

    owner = await mintUser(app);
    peer = await mintUser(app);

    wsId = (await createWorkspace(owner.id)).id;
    await addMember(wsId, peer.id, "MEMBER");
  });

  describe("joining", () => {
    it("replays the stored Yjs state to a member", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });
      // Seed state as a previous session would have.
      const seeded = new Y.Doc();
      seeded.getText("content").insert(0, "persisted text");
      await testPrisma.document.update({
        where: { id: doc.id },
        data: { yjsState: Buffer.from(Y.encodeStateAsUpdate(seeded)) },
      });

      const socket = await openSocket(server, owner);
      const local = await joinDoc(socket, doc.id);

      expect(local.getText("content").toString()).toBe("persisted text");
    });

    it("refuses a non-member", async () => {
      const outsider = await mintUser(app);
      const doc = await createDocument(wsId, { type: "MARKDOWN" });

      const socket = await openSocket(server, outsider);
      const failure = waitForEvent<string>(socket, "doc:error");
      socket.emit("doc:join", doc.id);

      await expect(failure).resolves.toBe("Not a member");
      expect(docs.has(doc.id)).toBe(false);
    });

    it("refuses a documentId that does not exist", async () => {
      const socket = await openSocket(server, owner);

      const failure = waitForEvent<string>(socket, "doc:error");
      // A valid cuid-shape but no row — `findUnique` returns null and the
      // handler must tell the client rather than hang the join.
      socket.emit("doc:join", "clxxxxxxxxxxxxxxxxxxxxxx");

      await expect(failure).resolves.toBe("Document not found");
    });

    it("keeps the document in memory for the life of the room", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });
      const socket = await openSocket(server, owner);
      await joinDoc(socket, doc.id);

      expect(docs.has(doc.id)).toBe(true);
    });
  });

  describe("updates", () => {
    it("relays a binary update to other room members", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });

      const ownerSocket = await openSocket(server, owner);
      await joinDoc(ownerSocket, doc.id);

      const peerSocket = await openSocket(server, peer);
      const peerLocal = await joinDoc(peerSocket, doc.id);

      const incoming = waitForEvent<number[]>(peerSocket, "doc:update");
      const local = new Y.Doc();
      local.getText("content").insert(0, "typed live");
      ownerSocket.emit(
        "doc:update",
        doc.id,
        Array.from(Y.encodeStateAsUpdate(local)),
      );

      Y.applyUpdate(peerLocal, Uint8Array.from(await incoming));
      expect(peerLocal.getText("content").toString()).toBe("typed live");
    });
  });

  describe("one-shot AI seed", () => {
    it("injects initialContent into the document and then clears the column", async () => {
      const seeded = "# Generated\n\nBody text.";
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        initialContent: seeded,
      });

      const socket = await openSocket(server, owner);
      const local = await joinDoc(socket, doc.id);

      expect(local.getMap("metadata").get("initialContent")).toBe(seeded);
      await expect(
        testPrisma.document.findUnique({ where: { id: doc.id } }),
      ).resolves.toMatchObject({ initialContent: null });
    });

    it("does not re-seed on a later join", async () => {
      const seeded = "# Generated once";
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        initialContent: seeded,
      });

      const first = await openSocket(server, owner);
      await joinDoc(first, doc.id);
      first.close();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // The content survives via Yjs state, not by re-running the seed.
      const second = await openSocket(server, peer);
      const local = await joinDoc(second, doc.id);

      expect(local.getMap("metadata").get("initialContent")).toBe(seeded);
      await expect(
        testPrisma.document.findUnique({ where: { id: doc.id } }),
      ).resolves.toMatchObject({ initialContent: null });
    });

    it("leaves a CANVAS document's initialContent untouched", async () => {
      const doc = await createDocument(wsId, { type: "CANVAS" });

      const socket = await openSocket(server, owner);
      await joinDoc(socket, doc.id);

      const stored = await testPrisma.document.findUnique({
        where: { id: doc.id },
      });
      expect(stored?.initialContent).toBeNull();
    });
  });

  describe("leaving", () => {
    it("snapshots the merged state to Postgres once the room drains", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });
      const socket = await openSocket(server, owner);
      const local = await joinDoc(socket, doc.id);

      const change = new Y.Doc();
      change.getText("content").insert(0, "saved on leave");
      socket.emit(
        "doc:update",
        doc.id,
        Array.from(Y.encodeStateAsUpdate(change)),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));

      socket.emit("doc:leave", doc.id);
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(docs.has(doc.id)).toBe(false);

      const stored = await testPrisma.document.findUnique({
        where: { id: doc.id },
      });
      const restored = new Y.Doc();
      if (stored?.yjsState) Y.applyUpdate(restored, stored.yjsState);
      expect(restored.getText("content").toString()).toBe("saved on leave");

      // The sender never receives its own update back — the relay uses
      // `socket.to(room)`. A real client therefore relies on its own local Yjs
      // state, not on the server echoing the edit.
      expect(local.getText("content").toString()).toBe("");
    });

    it("keeps the document live while another member remains", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });

      const ownerSocket = await openSocket(server, owner);
      await joinDoc(ownerSocket, doc.id);
      const peerSocket = await openSocket(server, peer);
      await joinDoc(peerSocket, doc.id);

      ownerSocket.emit("doc:leave", doc.id);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(docs.has(doc.id)).toBe(true);
    });
  });
});
