/**
 * @module api/__tests__/integration/socket/document
 * @description Server-side Yjs document collaboration: hydration from Postgres,
 * binary update relay, the one-shot AI seed, and the snapshot-on-drain lifecycle.
 *
 * The client side is simulated with a local `Y.Doc` that applies the same
 * updates, which is what a real browser does.
 */
import { prisma } from "@nimbus/db";
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
  vi,
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

    // A database failure during the join must reach the client as an error —
    // the alternative is a socket that looks connected and silently never syncs.
    it("reports a failure when the join cannot reach the database", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });
      const socket = await openSocket(server, owner);

      const spy = vi
        .spyOn(prisma.document, "findUnique")
        .mockRejectedValueOnce(new Error("database unavailable"));

      const failure = waitForEvent<string>(socket, "doc:error");
      socket.emit("doc:join", doc.id);
      const message = await failure;
      spy.mockRestore();

      expect(message).toBe("Something went wrong");
      expect(docs.has(doc.id)).toBe(false);
    });

    // The membership check and the hydration are two separate reads; the row
    // can disappear between them. That must be reported, not silently joined.
    it("reports a missing document when the row vanishes mid-join", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });
      const full = await testPrisma.document.findUnique({
        where: { id: doc.id },
        include: { workspace: { include: { members: true } } },
      });
      const socket = await openSocket(server, owner);

      const spy = vi
        .spyOn(prisma.document, "findUnique")
        .mockResolvedValueOnce(full as never)
        .mockResolvedValueOnce(null as never);

      const failure = waitForEvent<string>(socket, "doc:error");
      socket.emit("doc:join", doc.id);
      const message = await failure;
      spy.mockRestore();

      expect(message).toBe("Document not found");
      expect(docs.has(doc.id)).toBe(false);
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
    /**
     * Applies a template the way the editor does: puts the body into the
     * `prosemirror` fragment and drops the metadata key that marks the seed as
     * pending. Both changes hitch a ride on one binary update.
     */
    const consumeSeed = (local: Y.Doc, body: string) => {
      const fragment = local.getXmlFragment("prosemirror");
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText(body)]);
      fragment.insert(0, [paragraph]);
      local.getMap("metadata").delete("initialContent");
    };

    it("delivers initialContent but keeps the column until the seed is consumed", async () => {
      const seeded = "# Generated\n\nBody text.";
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        initialContent: seeded,
      });

      const socket = await openSocket(server, owner);
      const local = await joinDoc(socket, doc.id);

      expect(local.getMap("metadata").get("initialContent")).toBe(seeded);

      // @important The column must survive the join. Clearing it here is how a
      // client that unmounts before applying the template — routine when a
      // re-render tears the session down — used to lose the document entirely.
      await expect(
        testPrisma.document.findUnique({ where: { id: doc.id } }),
      ).resolves.toMatchObject({ initialContent: seeded });
    });

    it("clears the column once a client has consumed the seed", async () => {
      const seeded = "# Generated\n\nBody text.";
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        initialContent: seeded,
      });

      const socket = await openSocket(server, owner);
      const local = await joinDoc(socket, doc.id);

      consumeSeed(local, seeded);
      socket.emit(
        "doc:update",
        doc.id,
        Array.from(Y.encodeStateAsUpdate(local)),
      );
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Leaving forces the snapshot that proves the seed landed in yjsState.
      socket.emit("doc:leave", doc.id);
      await new Promise((resolve) => setTimeout(resolve, 600));

      await expect(
        testPrisma.document.findUnique({ where: { id: doc.id } }),
      ).resolves.toMatchObject({ initialContent: null });
    });

    it("re-seeds rather than losing the document when the seed is never consumed", async () => {
      const seeded = "# Generated but never applied";
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        initialContent: seeded,
      });

      const first = await openSocket(server, owner);
      await joinDoc(first, doc.id);
      first.close();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Nothing applied the template, so the column is still the only copy.
      await expect(
        testPrisma.document.findUnique({ where: { id: doc.id } }),
      ).resolves.toMatchObject({ initialContent: seeded });

      const second = await openSocket(server, peer);
      const local = await joinDoc(second, doc.id);

      expect(local.getMap("metadata").get("initialContent")).toBe(seeded);
    });

    it("does not re-seed once the content lives in the Yjs state", async () => {
      const seeded = "# Generated once";
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        initialContent: seeded,
      });

      const first = await openSocket(server, owner);
      const consumed = await joinDoc(first, doc.id);

      consumeSeed(consumed, seeded);
      first.emit(
        "doc:update",
        doc.id,
        Array.from(Y.encodeStateAsUpdate(consumed)),
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      first.emit("doc:leave", doc.id);
      await new Promise((resolve) => setTimeout(resolve, 600));

      // The body survives via Yjs state, not by re-running the seed.
      const second = await openSocket(server, peer);
      const local = await joinDoc(second, doc.id);

      expect(local.getMap("metadata").get("initialContent")).toBeUndefined();
      expect(local.getXmlFragment("prosemirror").toString()).toContain(seeded);
    });

    it("clears a stale seed when the body is already in the Yjs state", async () => {
      const seeded = "# Already applied";
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        initialContent: seeded,
      });

      // A previous session applied the template but died before the column was
      // cleared: the fragment has content and the column is still set. Joining
      // must not hand the template out again, which would duplicate the body.
      const previous = new Y.Doc();
      const fragment = previous.getXmlFragment("prosemirror");
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText("existing body")]);
      fragment.insert(0, [paragraph]);
      await testPrisma.document.update({
        where: { id: doc.id },
        data: { yjsState: Buffer.from(Y.encodeStateAsUpdate(previous)) },
      });

      const socket = await openSocket(server, owner);
      const local = await joinDoc(socket, doc.id);

      expect(local.getMap("metadata").get("initialContent")).toBeUndefined();
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

    // A row deleted under a live socket leaves the final snapshot with nothing
    // to update. The eviction must still happen — a failed write is not a
    // reason to keep serving a document that no longer exists.
    it("still evicts when the document row was deleted mid-session", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });
      const socket = await openSocket(server, owner);
      await joinDoc(socket, doc.id);

      await testPrisma.document.delete({ where: { id: doc.id } });

      socket.emit("doc:leave", doc.id);
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(docs.has(doc.id)).toBe(false);
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

    // The eviction race: `doc:leave` used to delete the map entry after its
    // awaited snapshot, so a rejoin landing inside that window joined the room
    // and then lost its doc — every later update hit `if (!doc) return` and was
    // dropped, and the text vanished on the next rehydrate.
    it("keeps syncing across an immediate leave/rejoin", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });

      const peerSocket = await openSocket(server, peer);
      await joinDoc(peerSocket, doc.id);

      const ownerSocket = await openSocket(server, owner);
      await joinDoc(ownerSocket, doc.id);

      ownerSocket.emit("doc:leave", doc.id);
      const restated = waitForEvent<number[]>(ownerSocket, "doc:state");
      ownerSocket.emit("doc:join", doc.id);
      await restated;

      const incoming = waitForEvent<number[]>(peerSocket, "doc:update");
      const change = new Y.Doc();
      change.getText("content").insert(0, "survives the round trip");
      ownerSocket.emit(
        "doc:update",
        doc.id,
        Array.from(Y.encodeStateAsUpdate(change)),
      );

      await expect(incoming).resolves.toBeDefined();
      expect(docs.has(doc.id)).toBe(true);
    });

    // The self-heal path: even if an entry is lost, an update from a socket
    // that is still in the room must rehydrate rather than disappear.
    it("rehydrates and relays an update when the in-memory doc is gone", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });

      const ownerSocket = await openSocket(server, owner);
      await joinDoc(ownerSocket, doc.id);
      const peerSocket = await openSocket(server, peer);
      const peerLocal = await joinDoc(peerSocket, doc.id);

      docs.delete(doc.id);

      const incoming = waitForEvent<number[]>(peerSocket, "doc:update");
      const local = new Y.Doc();
      local.getText("content").insert(0, "after eviction");
      ownerSocket.emit(
        "doc:update",
        doc.id,
        Array.from(Y.encodeStateAsUpdate(local)),
      );

      Y.applyUpdate(peerLocal, Uint8Array.from(await incoming));
      expect(peerLocal.getText("content").toString()).toBe("after eviction");
      expect(docs.has(doc.id)).toBe(true);
    });

    // The row can vanish under a live socket (another member deletes the
    // document). The rehydrate path must report that rather than resurrect an
    // empty doc and write it back over nothing.
    it("reports an error when the document row disappears mid-session", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });
      const socket = await openSocket(server, owner);
      await joinDoc(socket, doc.id);

      await testPrisma.document.delete({ where: { id: doc.id } });
      docs.delete(doc.id);

      const failure = waitForEvent<string>(socket, "doc:error");
      const local = new Y.Doc();
      local.getText("content").insert(0, "into the void");
      socket.emit(
        "doc:update",
        doc.id,
        Array.from(Y.encodeStateAsUpdate(local)),
      );

      await expect(failure).resolves.toBe("Document not found");
      expect(docs.has(doc.id)).toBe(false);
    });

    it("reports a malformed binary update without crashing the handler", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });
      const socket = await openSocket(server, owner);
      await joinDoc(socket, doc.id);

      const failure = waitForEvent<string>(socket, "doc:error");
      // A truncated varint — Yjs rejects it, and the handler must contain that
      // rather than let it escape into the socket layer.
      socket.emit("doc:update", doc.id, [255, 255, 255, 255, 255]);

      await expect(failure).resolves.toBe("Something went wrong");
    });
  });
});
