/**
 * @module api/__tests__/integration/http/documentManage
 * @description Renaming, exporting and searching documents over HTTP, and the
 * `document:created` / `document:renamed` / `document:deleted` broadcasts those
 * routes and the create and delete routes make.
 *
 * Plain requests go through `createApp()` (no Socket.IO server, so nothing is
 * broadcast); the broadcast cases run a real server and a real client socket,
 * and each waits for the event it provoked before ending.
 */
import request from "supertest";
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
  as,
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

/** A persisted Yjs state with one paragraph per string. */
const stateWith = (...paragraphs: string[]) => {
  const doc = new Y.Doc();
  const root = doc.getXmlFragment("prosemirror");
  for (const words of paragraphs) {
    const paragraph = new Y.XmlElement("paragraph");
    root.insert(root.length, [paragraph]);
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    text.insert(0, words);
  }
  return Buffer.from(Y.encodeStateAsUpdate(doc));
};

describe("http: document rename, export and search", () => {
  let server: TestServer;
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let wsId: string;

  const open = async (user: TestUser) => {
    const socket = connectClient(server.url, { Cookie: user.cookie });
    await waitForEvent(socket, "connect");
    openSockets.push(socket);
    return socket;
  };

  const inRoom = async (user: TestUser, workspaceId = wsId) => {
    const socket = await open(user);
    socket.emit("workspace:join", workspaceId);
    await waitForEvent(socket, "presence:online_users");
    return socket;
  };

  /** A request against the real server, as a user. */
  const live = (user: TestUser) => ({
    patch: (url: string) =>
      request(server.url).patch(url).set("Cookie", user.cookie),
    post: (url: string) =>
      request(server.url).post(url).set("Cookie", user.cookie),
    get: (url: string) =>
      request(server.url).get(url).set("Cookie", user.cookie),
    delete: (url: string) =>
      request(server.url).delete(url).set("Cookie", user.cookie),
  });

  /** Events of one name a socket sees over a short window. */
  const eventsOver = async (
    socket: ClientSocket,
    event: string,
    ms: number,
  ) => {
    const seen: unknown[] = [];
    socket.on(event, (payload) => seen.push(payload));
    await new Promise((resolve) => setTimeout(resolve, ms));
    socket.off(event);
    return seen;
  };

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
    member = await mintUser(app);
    outsider = await mintUser(app);
    wsId = (await createWorkspace(owner.id)).id;
    await addMember(wsId, member.id, "MEMBER");
  });

  describe("PATCH /api/document/:docId", () => {
    it("lets a plain member rename, trims the title and stores it", async () => {
      const doc = await createDocument(wsId, { title: "Before" });

      const res = await as(app, member)
        .patch(`/api/document/${doc.id}`)
        .send({ title: "  After  " });

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toEqual({ id: doc.id, title: "After" });
      await expect(
        testPrisma.document.findUniqueOrThrow({ where: { id: doc.id } }),
      ).resolves.toMatchObject({ title: "After" });
    });

    it("accepts exactly 100 characters", async () => {
      const doc = await createDocument(wsId);
      const title = "t".repeat(100);

      const res = await as(app, owner)
        .patch(`/api/document/${doc.id}`)
        .send({ title });

      expect(res.status).toBe(200);
      expect(res.body.responseObject.title).toBe(title);
    });

    it.each([
      ["an empty title", { title: "" }],
      ["a whitespace title", { title: "   " }],
      ["a 101 character title", { title: "t".repeat(101) }],
      ["a missing title", {}],
      ["a non-string title", { title: 5 }],
    ])("refuses %s with 400 and changes nothing", async (_label, body) => {
      const doc = await createDocument(wsId, { title: "Keep me" });

      const res = await as(app, owner)
        .patch(`/api/document/${doc.id}`)
        .send(body);

      expect(res.status).toBe(400);
      await expect(
        testPrisma.document.findUniqueOrThrow({ where: { id: doc.id } }),
      ).resolves.toMatchObject({ title: "Keep me" });
    });

    it("answers a non-member with 404, as for a document that does not exist", async () => {
      const doc = await createDocument(wsId, { title: "Private" });

      const denied = await as(app, outsider)
        .patch(`/api/document/${doc.id}`)
        .send({ title: "Hijacked" });
      const missing = await as(app, owner)
        .patch("/api/document/cm_does_not_exist_000")
        .send({ title: "Anything" });

      expect(denied.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(denied.body.message).toBe(missing.body.message);
      await expect(
        testPrisma.document.findUniqueOrThrow({ where: { id: doc.id } }),
      ).resolves.toMatchObject({ title: "Private" });
    });

    it("requires a session", async () => {
      const doc = await createDocument(wsId);

      const res = await request(app)
        .patch(`/api/document/${doc.id}`)
        .send({ title: "No session" });

      expect(res.status).toBe(401);
    });

    it("broadcasts document:renamed to the workspace, awaited by a member's socket", async () => {
      const doc = await createDocument(wsId, { title: "Before" });
      const watcher = await inRoom(owner);
      const renamed = waitForEvent(watcher, "document:renamed");

      const res = await live(member)
        .patch(`/api/document/${doc.id}`)
        .send({ title: " After " });

      expect(res.status).toBe(200);
      await expect(renamed).resolves.toEqual({
        documentId: doc.id,
        title: "After",
      });
    });

    it("does not broadcast to another workspace's room", async () => {
      const doc = await createDocument(wsId, { title: "Before" });
      const otherWs = (await createWorkspace(outsider.id)).id;
      const watcher = await inRoom(owner);
      const stranger = await inRoom(outsider, otherWs);
      const mine = waitForEvent(watcher, "document:renamed");
      const strangers = eventsOver(stranger, "document:renamed", 600);

      await live(owner)
        .patch(`/api/document/${doc.id}`)
        .send({ title: "After" });

      await mine;
      await expect(strangers).resolves.toEqual([]);
    });

    it("is a quiet no-op when the title is unchanged", async () => {
      const doc = await createDocument(wsId, { title: "Same" });
      const watcher = await inRoom(owner);
      const seen = eventsOver(watcher, "document:renamed", 600);

      const res = await live(owner)
        .patch(`/api/document/${doc.id}`)
        .send({ title: " Same " });

      expect(res.status).toBe(200);
      await expect(seen).resolves.toEqual([]);
    });
  });

  describe("document:created and document:deleted", () => {
    it("announces a created document with its summary", async () => {
      const watcher = await inRoom(member);
      const created = waitForEvent<{ document: Record<string, unknown> }>(
        watcher,
        "document:created",
      );

      const res = await live(owner)
        .post("/api/document/create")
        .send({ title: "Fresh doc", workspaceId: wsId, type: "MARKDOWN" });

      expect(res.status).toBe(201);
      const { document } = await created;
      expect(document).toMatchObject({
        id: res.body.responseObject.id,
        title: "Fresh doc",
        type: "MARKDOWN",
        workspaceId: wsId,
      });
      expect(typeof document.createdAt).toBe("string");
      expect(document).not.toHaveProperty("yjsState");
      expect(document).not.toHaveProperty("canvasData");
    });

    it("announces a deletion, and nothing for a refused one", async () => {
      const doc = await createDocument(wsId);
      const watcher = await inRoom(owner);

      const refused = eventsOver(watcher, "document:deleted", 600);
      const denied = await live(member).delete(`/api/document/${doc.id}`);
      expect(denied.status).toBe(403);
      await expect(refused).resolves.toEqual([]);

      const deleted = waitForEvent(watcher, "document:deleted");
      const ok = await live(owner).delete(`/api/document/${doc.id}`);
      expect(ok.status).toBe(200);
      await expect(deleted).resolves.toEqual({
        documentId: doc.id,
        deletedById: owner.id,
      });
    });
  });

  describe("GET /api/document/:docId/export", () => {
    it("renders a markdown document's Yjs state as markdown", async () => {
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        title: "Notes",
      });
      await testPrisma.document.update({
        where: { id: doc.id },
        data: { yjsState: stateWith("first", "second") },
      });

      const res = await as(app, member).get(`/api/document/${doc.id}/export`);

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toEqual({
        type: "MARKDOWN",
        title: "Notes",
        markdown: "first\n\nsecond\n",
      });
    });

    it("returns an unconsumed seed, and an empty string for a blank document", async () => {
      const seeded = await createDocument(wsId, {
        type: "MARKDOWN",
        initialContent: "# Seed\n\nbody",
      });
      const blank = await createDocument(wsId, { type: "MARKDOWN" });

      const a = await as(app, owner).get(`/api/document/${seeded.id}/export`);
      const b = await as(app, owner).get(`/api/document/${blank.id}/export`);

      expect(a.body.responseObject.markdown).toBe("# Seed\n\nbody");
      expect(b.body.responseObject.markdown).toBe("");
    });

    it("returns a canvas's element array", async () => {
      const elements = [{ id: "a", type: "text", text: "hello" }];
      const canvas = await createDocument(wsId, {
        type: "CANVAS",
        title: "Board",
        canvasData: elements,
      });

      const res = await as(app, owner).get(`/api/document/${canvas.id}/export`);

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toEqual({
        type: "CANVAS",
        title: "Board",
        elements,
      });
    });

    it("includes edits still waiting for their debounced save", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });
      const socket = await open(owner);
      const state = waitForEvent<number[]>(socket, "doc:state");
      socket.emit("doc:join", doc.id);
      const local = new Y.Doc();
      Y.applyUpdate(local, Uint8Array.from(await state));
      const before = Y.encodeStateVector(local);
      const root = local.getXmlFragment("prosemirror");
      const paragraph = new Y.XmlElement("paragraph");
      root.insert(0, [paragraph]);
      const text = new Y.XmlText();
      paragraph.insert(0, [text]);
      text.insert(0, "unsaved live words");
      socket.emit(
        "doc:update",
        doc.id,
        Array.from(Y.encodeStateAsUpdate(local, before)),
      );
      // The row is still empty: the 5 second debounce has not fired.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await expect(
        testPrisma.document.findUniqueOrThrow({ where: { id: doc.id } }),
      ).resolves.toMatchObject({ yjsState: null });

      const res = await live(owner).get(`/api/document/${doc.id}/export`);

      expect(res.body.responseObject.markdown).toBe("unsaved live words\n");
      await expect(
        testPrisma.document.findUniqueOrThrow({ where: { id: doc.id } }),
      ).resolves.toMatchObject({ searchText: "unsaved live words" });
    });

    it("answers a non-member and an unknown document alike with 404", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });

      const denied = await as(app, outsider).get(
        `/api/document/${doc.id}/export`,
      );
      const missing = await as(app, owner).get(
        "/api/document/cm_does_not_exist_000/export",
      );

      expect(denied.status).toBe(404);
      expect(missing.status).toBe(404);
    });
  });

  describe("GET /api/document/search", () => {
    const search = (user: TestUser, query: Record<string, string>) =>
      as(app, user).get(
        `/api/document/search?${new URLSearchParams(query).toString()}`,
      );

    it("finds a document by its body and marks the match in the excerpt", async () => {
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        title: "Runbook",
        searchText: "Restart the pump, then check the valve pressure.",
      });
      await createDocument(wsId, { title: "Other", searchText: "unrelated" });

      const res = await search(member, { workspaceId: wsId, q: "valve" });

      expect(res.status).toBe(200);
      expect(res.body.responseObject.hits).toHaveLength(1);
      expect(res.body.responseObject.hits[0]).toMatchObject({
        documentId: doc.id,
        title: "Runbook",
        type: "MARKDOWN",
        snippet: expect.stringContaining("<mark>valve</mark>"),
      });
    });

    it("finds a document by its title alone", async () => {
      const doc = await createDocument(wsId, {
        title: "Quarterly roadmap",
        searchText: null,
      });

      const res = await search(owner, { workspaceId: wsId, q: "roadmap" });

      expect(res.body.responseObject.hits).toMatchObject([
        {
          documentId: doc.id,
          snippet: expect.stringContaining("<mark>roadmap</mark>"),
        },
      ]);
    });

    it("reads quoted phrases, or and exclusion", async () => {
      await createDocument(wsId, {
        title: "A",
        searchText: "blue green deploy",
      });
      await createDocument(wsId, { title: "B", searchText: "green only" });
      await createDocument(wsId, { title: "C", searchText: "blue only" });

      const phrase = await search(owner, {
        workspaceId: wsId,
        q: '"blue green"',
      });
      const either = await search(owner, {
        workspaceId: wsId,
        q: "green or blue",
      });
      const without = await search(owner, {
        workspaceId: wsId,
        q: "green -blue",
      });

      expect(
        phrase.body.responseObject.hits.map((h: { title: string }) => h.title),
      ).toEqual(["A"]);
      expect(either.body.responseObject.hits).toHaveLength(3);
      expect(
        without.body.responseObject.hits.map((h: { title: string }) => h.title),
      ).toEqual(["B"]);
    });

    it("never returns another workspace's documents", async () => {
      const otherWs = (await createWorkspace(outsider.id)).id;
      await createDocument(otherWs, {
        title: "Secret",
        searchText: "zebra plan",
      });
      await createDocument(wsId, { title: "Mine", searchText: "zebra herd" });

      const res = await search(owner, { workspaceId: wsId, q: "zebra" });

      expect(
        res.body.responseObject.hits.map((h: { title: string }) => h.title),
      ).toEqual(["Mine"]);
    });

    it("honours the limit and ranks stronger matches first", async () => {
      await createDocument(wsId, { title: "Weak", searchText: "gadget" });
      await createDocument(wsId, {
        title: "Strong gadget",
        searchText: "gadget gadget gadget",
      });
      await createDocument(wsId, { title: "Third", searchText: "gadget" });

      const all = await search(owner, { workspaceId: wsId, q: "gadget" });
      const one = await search(owner, {
        workspaceId: wsId,
        q: "gadget",
        limit: "1",
      });

      expect(all.body.responseObject.hits).toHaveLength(3);
      expect(all.body.responseObject.hits[0].title).toBe("Strong gadget");
      expect(one.body.responseObject.hits).toHaveLength(1);
    });

    it("is not captured by the :docId route", async () => {
      const res = await search(owner, { workspaceId: wsId, q: "anything" });

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toEqual({ hits: [] });
    });

    it("treats hostile query text as plain text", async () => {
      await createDocument(wsId, { title: "Safe", searchText: "intact" });

      const res = await search(owner, {
        workspaceId: wsId,
        q: `'; DROP TABLE "Document"; --`,
      });

      expect(res.status).toBe(200);
      await expect(testPrisma.document.count()).resolves.toBe(1);
    });

    it.each([
      ["a missing query", { workspaceId: "ws" }],
      ["a blank query", { workspaceId: "ws", q: "   " }],
      ["a missing workspace", { q: "x" }],
      ["an over-long query", { workspaceId: "ws", q: "x".repeat(201) }],
      ["a limit above the maximum", { workspaceId: "ws", q: "x", limit: "51" }],
      ["a limit of zero", { workspaceId: "ws", q: "x", limit: "0" }],
    ])("refuses %s with 400", async (_label, query) => {
      const res = await search(owner, query);

      expect(res.status).toBe(400);
    });

    it("answers a non-member with 404", async () => {
      await createDocument(wsId, { title: "Hidden", searchText: "needle" });

      const res = await search(outsider, { workspaceId: wsId, q: "needle" });

      expect(res.status).toBe(404);
    });

    it("requires a session", async () => {
      const res = await request(app).get(
        `/api/document/search?workspaceId=${wsId}&q=x`,
      );

      expect(res.status).toBe(401);
    });
  });
});
