/**
 * @module api/__tests__/security/guards
 * @description The authorization matrix: every protected route rejects anonymous
 * callers, cross-workspace resource IDs are denied to authenticated
 * non-members, and socket events re-check membership rather than trusting a room.
 *
 * This is the suite that guards multi-tenant data. `resetDatabase()` runs before
 * each test so a leaked membership can never make a denial test pass for the
 * wrong reason.
 */
import request from "supertest";
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
import { createApp } from "../../app";
import { canvases } from "../../socket/canvas";
import { docs } from "../../socket/document";
import {
  as,
  closeTestResources,
  connectClient,
  createDocument,
  createWorkspace,
  mintUser,
  resetDatabase,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from "@testhelpers";

const app = createApp();

// Closed once per file, after every describe. Closing inside a describe would
// tear down the shared Redis client for the describes that follow.
afterAll(closeTestResources);

/** Placeholder ids — `authCheck` runs before anything reads them. */
const R = "cm_dummy_id";
const ROUTES = [
  { method: "get", path: "/api/workspace" },
  { method: "post", path: "/api/workspace/create", body: { name: "Abc" } },
  { method: "post", path: "/api/workspace/join", body: { inviteCode: "x" } },
  { method: "put", path: `/api/workspace/regenerate-invite/${R}` },
  { method: "put", path: `/api/workspace/role/${R}` },
  { method: "delete", path: `/api/workspace/leave/${R}` },
  { method: "put", path: `/api/workspace/update/${R}` },
  { method: "delete", path: `/api/workspace/delete/${R}` },
  { method: "get", path: "/api/workspace/1" },
  { method: "get", path: `/api/messages/${R}` },
  { method: "post", path: "/api/document/create", body: { title: "Abc" } },
  { method: "get", path: `/api/document/workspace/${R}` },
  { method: "get", path: `/api/document/${R}` },
  { method: "delete", path: `/api/document/${R}` },
  { method: "get", path: "/api/turn/credentials" },
  { method: "get", path: "/api/upload/avatar-signature" },
] as const;

const send = (route: (typeof ROUTES)[number]) => {
  const body = "body" in route ? route.body : {};
  switch (route.method) {
    case "get":
      return request(app).get(route.path);
    case "post":
      return request(app).post(route.path).send(body);
    case "put":
      return request(app).put(route.path).send(body);
    case "delete":
      return request(app).delete(route.path).send(body);
  }
};

describe("security: anonymous access", () => {
  beforeEach(resetDatabase);

  it.each(ROUTES)("$method $path → 401", async (route) => {
    const res = await send(route);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, statusCode: 401 });
  });
});

describe("security: cross-workspace access by a non-member", () => {
  let owner: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let slugId: number;
  let docId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await mintUser(app);
    outsider = await mintUser(app);

    const ws = await createWorkspace(owner.id);
    workspaceId = ws.id;
    slugId = ws.slugId;

    const doc = await createDocument(ws.id, { type: "MARKDOWN" });
    docId = doc.id;
  });

  it("denies reading a document in someone else's workspace", async () => {
    const res = await as(app, outsider).get(`/api/document/${docId}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not a member/i);
  });

  it("denies listing another workspace's documents", async () => {
    const res = await as(app, outsider).get(`/api/document/workspace/${workspaceId}`);

    expect(res.status).toBe(403);
  });

  it("denies deleting a document in someone else's workspace", async () => {
    const res = await as(app, outsider).delete(`/api/document/${docId}`);

    expect(res.status).toBe(403);
  });

  // The message controller answers non-members with 401 (not 403). Pinned as
  // observed: it is a non-disclosure choice, but it reads as "unauthenticated"
  // rather than "forbidden", which is worth a conscious decision.
  it("answers a non-member's message-list request with 401", async () => {
    const res = await as(app, outsider).get(`/api/messages/${workspaceId}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Unauthorized");
  });

  it("hides a workspace from a non-member as 404 rather than 403", async () => {
    const res = await as(app, outsider).get(`/api/workspace/${slugId}`);

    expect(res.status).toBe(404);
  });

  it("denies renaming someone else's workspace", async () => {
    const res = await as(app, outsider)
      .put(`/api/workspace/update/${workspaceId}`)
      .send({ name: "Hijacked", description: "" });

    expect(res.status).toBe(403);
  });

  it("denies deleting someone else's workspace", async () => {
    const res = await as(app, outsider).delete(`/api/workspace/delete/${workspaceId}`);

    expect(res.status).toBe(403);
  });

  it("denies rotating someone else's invite code", async () => {
    const res = await as(app, outsider).put(
      `/api/workspace/regenerate-invite/${workspaceId}`,
    );

    expect(res.status).toBe(403);
  });

  it("denies joining by a bogus invite code", async () => {
    const res = await as(app, outsider)
      .post("/api/workspace/join")
      .send({ inviteCode: "not-a-real-code" });

    expect(res.status).toBe(404);
  });

  it("still allows the owner through the same routes", async () => {
    const res = await as(app, owner).get(`/api/document/${docId}`);

    expect(res.status).toBe(200);
    expect(res.body.responseObject.id).toBe(docId);
  });
});

describe("security: socket guards", () => {
  let server: TestServer;
  let owner: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let docId: string;
  let canvasId: string;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    docs.clear();
    canvases.clear();

    owner = await mintUser(app);
    outsider = await mintUser(app);

    const ws = await createWorkspace(owner.id);
    workspaceId = ws.id;
    docId = (await createDocument(ws.id, { type: "MARKDOWN" })).id;
    canvasId = (await createDocument(ws.id, { type: "CANVAS" })).id;

    // The outsider is a real, authenticated user — just a member of nothing.
    expect(outsider.id).not.toBe(owner.id);
  });

  afterEach(() => {
    docs.clear();
    canvases.clear();
  });

  it("accepts an authenticated socket", async () => {
    const socket = connectClient(server.url, { Cookie: owner.cookie });

    try {
      // The "connect" event carries no payload, so assert on client state.
      await waitForEvent(socket, "connect");

      expect(socket.connected).toBe(true);
    } finally {
      socket.close();
    }
  });

  it("lets a member join the workspace room", async () => {
    const socket = connectClient(server.url, { Cookie: owner.cookie });
    await waitForEvent(socket, "connect");

    try {
      socket.emit("workspace:join", workspaceId);
      const roster = await waitForEvent<string[]>(socket, "presence:online_users");

      expect(roster).toContain(owner.id);
    } finally {
      socket.close();
    }
  });

  // Pinned as observed: a non-member join is silent — no membership event and no
  // error. The client cannot distinguish "denied" from "still connecting".
  it("leaves a non-member's workspace:join unanswered", async () => {
    const socket = connectClient(server.url, { Cookie: outsider.cookie });
    await waitForEvent(socket, "connect");

    const seen: string[] = [];
    for (const event of ["presence:joined", "presence:online_users"]) {
      socket.on(event, () => seen.push(event));
    }

    try {
      socket.emit("workspace:join", workspaceId);
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(seen).toEqual([]);
    } finally {
      socket.close();
    }
  });

  it("denies doc:join to a non-member", async () => {
    const socket = connectClient(server.url, { Cookie: outsider.cookie });
    await waitForEvent(socket, "connect");

    try {
      socket.emit("doc:join", docId);
      const error = await waitForEvent<string>(socket, "doc:error");

      expect(error).toBe("Not a member");
      expect(docs.has(docId)).toBe(false);
    } finally {
      socket.close();
    }
  });

  it("denies canvas:join to a non-member", async () => {
    const socket = connectClient(server.url, { Cookie: outsider.cookie });
    await waitForEvent(socket, "connect");

    try {
      socket.emit("canvas:join", canvasId);
      const error = await waitForEvent<string>(socket, "canvas:error");

      expect(error).toBe("Not a member");
      expect(canvases.has(canvasId)).toBe(false);
    } finally {
      socket.close();
    }
  });

  it("rejects canvas:update from a socket that never joined the canvas", async () => {
    // canvas:update checks room membership, so stray writes are refused.
    const socket = connectClient(server.url, { Cookie: owner.cookie });
    await waitForEvent(socket, "connect");

    try {
      socket.emit("canvas:update", {
        documentId: canvasId,
        elements: [{ id: "forged" }],
      });
      const error = await waitForEvent<string>(socket, "canvas:error");

      expect(error).toBe("Not joined to canvas");
      expect(canvases.has(canvasId)).toBe(false);
    } finally {
      socket.close();
    }
  });

  /**
   * `doc:update` re-checks nothing itself, so it relies on room presence:
   * `doc:join` verifies membership before joining, and the handler drops any
   * update from a socket that is not in the room. This pins that gate — without
   * it, any authenticated socket that knows a docId can mutate a live document
   * and have the change broadcast and persisted. `canvas:update` (directly
   * above) guards the same way.
   */
  it("rejects doc:update from a socket that never joined the document", async () => {
    const memberSocket = connectClient(server.url, { Cookie: owner.cookie });
    await waitForEvent(memberSocket, "connect");

    // A member joins so the document becomes resident in the server's docs map
    // (doc:update early-returns for documents that are not live).
    memberSocket.emit("doc:join", docId);
    await waitForEvent(memberSocket, "doc:state");

    const live = docs.get(docId);
    expect(live).toBeDefined();

    const strangerSocket = connectClient(server.url, { Cookie: outsider.cookie });
    await waitForEvent(strangerSocket, "connect");

    const forged = new Y.Doc();
    forged.getMap("metadata").set("injectedByOutsider", "yes");

    try {
      strangerSocket.emit(
        "doc:update",
        docId,
        Array.from(Y.encodeStateAsUpdate(forged)),
      );
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(live?.getMap("metadata").get("injectedByOutsider")).toBeUndefined();
    } finally {
      memberSocket.close();
      strangerSocket.close();
    }
  });

  it("allows a member to join and leaves the document live in memory", async () => {
    const socket = connectClient(server.url, { Cookie: owner.cookie });
    await waitForEvent(socket, "connect");

    try {
      socket.emit("doc:join", docId);
      await waitForEvent(socket, "doc:state");

      expect(docs.has(docId)).toBe(true);
    } finally {
      socket.close();
    }
  });
});
