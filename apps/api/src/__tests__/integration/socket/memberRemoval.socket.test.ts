/**
 * @module api/__tests__/integration/socket/memberRemoval
 * @description What a removed member's open sockets can still see and say:
 * nothing from the workspace room, its documents or its canvases, and no typing
 * relays into a room they are not in.
 *
 * The removal goes through the real REST route on the same server the sockets
 * are connected to, so the eviction runs exactly as in production.
 */
import request from "supertest";
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
import { presenceService } from "../../../lib/presence";
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
  type TestServer,
  type TestUser,
  waitForEvent,
} from "@testhelpers";

const app = createApp();

const openSockets: ClientSocket[] = [];

const quiet = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

describe("socket: member removal", () => {
  let server: TestServer;
  let owner: TestUser;
  let member: TestUser;
  let stayer: TestUser;
  let wsId: string;
  let docId: string;
  let canvasId: string;

  const open = async (user: TestUser) => {
    const socket = connectClient(server.url, { Cookie: user.cookie });
    await waitForEvent(socket, "connect");
    openSockets.push(socket);
    return socket;
  };

  /** A socket that has joined the workspace, a document and a canvas. */
  const joined = async (user: TestUser) => {
    const socket = await open(user);
    const online = waitForEvent(socket, "presence:online_users");
    socket.emit("workspace:join", wsId);
    await online;
    const docState = waitForEvent(socket, "doc:state");
    socket.emit("doc:join", docId);
    await docState;
    const canvasState = waitForEvent(socket, "canvas:state");
    socket.emit("canvas:join", canvasId);
    await canvasState;
    return socket;
  };

  const removeMember = (userId: string) =>
    request(server.url)
      .delete(`/api/workspace/leave/${wsId}`)
      .set("Cookie", owner.cookie)
      .send({ memberId: userId });

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await closeTestResources();
  });

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) socket.close();
    await vi.waitFor(() => expect(canvases.size).toBe(0), { timeout: 5_000 });
    canvases.clear();
  });

  beforeEach(async () => {
    await resetDatabase();
    canvases.clear();
    owner = await mintUser(app);
    member = await mintUser(app);
    stayer = await mintUser(app);
    wsId = (await createWorkspace(owner.id)).id;
    await addMember(wsId, member.id, "MEMBER");
    await addMember(wsId, stayer.id, "MEMBER");
    docId = (await createDocument(wsId, { type: "MARKDOWN" })).id;
    canvasId = (await createDocument(wsId, { type: "CANVAS" })).id;
  });

  it("stops delivering workspace, document and canvas events to a removed member", async () => {
    const ownerSocket = await joined(owner);
    const removed = await joined(member);
    const kept = await joined(stayer);

    const res = await removeMember(member.id);
    expect(res.status).toBe(200);

    const seen: string[] = [];
    for (const event of [
      "message:new",
      "typing:start",
      "doc:awareness",
      "canvas:pointer",
      "presence:left",
      "meeting:segment",
    ]) {
      removed.on(event, () => seen.push(event));
    }

    const keptMessage = waitForEvent(kept, "message:new");
    ownerSocket.emit("message:send", {
      workspaceId: wsId,
      content: "after removal",
    });
    await keptMessage;

    const keptTyping = waitForEvent(kept, "typing:start");
    ownerSocket.emit("typing:start", wsId);
    await keptTyping;

    const keptPointer = waitForEvent(kept, "canvas:pointer");
    ownerSocket.emit("canvas:pointer", { canvasId, x: 1, y: 2 });
    await keptPointer;

    ownerSocket.emit("doc:awareness", docId, [0]);
    await quiet();

    expect(seen).toEqual([]);
  });

  it("announces the departure to the rest of the workspace and clears presence", async () => {
    await joined(owner);
    const removed = await joined(member);
    const kept = await joined(stayer);
    expect(await presenceService.getOnlineUsers(wsId)).toContain(member.id);

    const left = waitForEvent<{ userId: string }>(kept, "presence:left");
    await removeMember(member.id);

    await expect(left).resolves.toEqual({ userId: member.id });
    expect(await presenceService.getOnlineUsers(wsId)).not.toContain(member.id);
    expect(removed.connected).toBe(true);
  });

  it("refuses typing relays from a removed member", async () => {
    const ownerSocket = await joined(owner);
    const removed = await joined(member);
    await removeMember(member.id);

    const heard: string[] = [];
    ownerSocket.on("typing:start", () => heard.push("start"));
    ownerSocket.on("typing:stop", () => heard.push("stop"));
    removed.emit("typing:start", wsId);
    removed.emit("typing:stop", wsId);
    await quiet();

    expect(heard).toEqual([]);
  });

  it("refuses typing relays into a workspace the socket never joined", async () => {
    const ownerSocket = await joined(owner);
    const outsider = await open(await mintUser(app));

    const heard: string[] = [];
    ownerSocket.on("typing:start", () => heard.push("start"));
    outsider.emit("typing:start", wsId);
    await quiet();

    expect(heard).toEqual([]);
  });

  it("leaves the removed user's sockets in other workspaces alone", async () => {
    const otherWs = (await createWorkspace(member.id)).id;
    const removed = await joined(member);
    const online = waitForEvent(removed, "presence:online_users");
    removed.emit("workspace:join", otherWs);
    await online;
    const peer = await mintUser(app);
    await addMember(otherWs, peer.id, "MEMBER");
    const peerSocket = await open(peer);
    const peerOnline = waitForEvent(peerSocket, "presence:online_users");
    peerSocket.emit("workspace:join", otherWs);
    await peerOnline;

    await removeMember(member.id);

    const typing = waitForEvent<{ userId: string }>(peerSocket, "typing:start");
    removed.emit("typing:start", otherWs);
    await expect(typing).resolves.toMatchObject({ userId: member.id });
  });
});
