/**
 * @module api/__tests__/integration/socket/canvasPointer
 * @description Live pointers on a canvas: relayed to the other members of the
 * room with an identity the server stamps from the session, announced gone when
 * a socket leaves or drops, and refused for sockets that are not in the room.
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
  vi,
} from "vitest";
import { presenceColor } from "@nimbus/utils";
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
  type TestServer,
  type TestUser,
  waitForEvent,
} from "@testhelpers";

const app = createApp();

const openSockets: ClientSocket[] = [];

type Pointer = {
  canvasId: string;
  socketId: string;
  user: { userId: string; name: string; color: string; image: string | null };
  x: number;
  y: number;
  tool?: string;
  button?: string;
  selectedElementIds?: string[];
};

describe("socket: canvas pointers", () => {
  let server: TestServer;
  let owner: TestUser;
  let peer: TestUser;
  let wsId: string;
  let canvasId: string;

  const open = async (user: TestUser) => {
    const socket = connectClient(server.url, { Cookie: user.cookie });
    await waitForEvent(socket, "connect");
    openSockets.push(socket);
    return socket;
  };

  const joinCanvas = async (user: TestUser) => {
    const socket = await open(user);
    const state = waitForEvent(socket, "canvas:state");
    socket.emit("canvas:join", canvasId);
    await state;
    return socket;
  };

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await closeTestResources();
  });

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) socket.close();
    // Disconnect handlers broadcast and snapshot asynchronously; letting them
    // finish keeps a Redis publish from landing after teardown.
    await vi.waitFor(() => expect(canvases.size).toBe(0), { timeout: 5_000 });
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

  it("relays a pointer to the other members with the session's identity", async () => {
    const a = await joinCanvas(owner);
    const b = await joinCanvas(peer);

    const received = waitForEvent<Pointer>(b, "canvas:pointer");
    a.emit("canvas:pointer", {
      canvasId,
      x: 10.5,
      y: -4,
      tool: "laser",
      button: "down",
      selectedElementIds: ["el-1", "el-2"],
    });

    const pointer = await received;
    expect(pointer).toEqual({
      canvasId,
      socketId: a.id,
      user: {
        userId: owner.id,
        name: owner.name,
        color: presenceColor(owner.id),
        image: null,
      },
      x: 10.5,
      y: -4,
      tool: "laser",
      button: "down",
      selectedElementIds: ["el-1", "el-2"],
    });
  });

  it("ignores identity fields a client adds to its pointer", async () => {
    const a = await joinCanvas(owner);
    const b = await joinCanvas(peer);

    const received = waitForEvent<Pointer>(b, "canvas:pointer");
    a.emit("canvas:pointer", {
      canvasId,
      x: 1,
      y: 2,
      user: { userId: peer.id, name: "Forged", color: "#000000" },
      socketId: "forged-socket",
    });

    const pointer = await received;
    expect(pointer.user.userId).toBe(owner.id);
    expect(pointer.user.name).toBe(owner.name);
    expect(pointer.socketId).toBe(a.id);
  });

  it("does not send a pointer back to its sender", async () => {
    const a = await joinCanvas(owner);
    const b = await joinCanvas(peer);
    const echoed = vi.fn();
    a.on("canvas:pointer", echoed);

    const received = waitForEvent<Pointer>(a, "canvas:pointer");
    b.emit("canvas:pointer", { canvasId, x: 1, y: 1 });
    await received;

    const own = waitForEvent<Pointer>(b, "canvas:pointer");
    a.emit("canvas:pointer", { canvasId, x: 2, y: 2 });
    await own;

    expect(echoed).toHaveBeenCalledTimes(1);
  });

  it("drops a malformed pointer without relaying it", async () => {
    const a = await joinCanvas(owner);
    const b = await joinCanvas(peer);
    const seen = vi.fn();
    b.on("canvas:pointer", seen);

    a.emit("canvas:pointer", { canvasId, x: "10", y: 2 });
    a.emit("canvas:pointer", { canvasId, x: Number.NaN, y: 2 });
    a.emit("canvas:pointer", { canvasId, x: 1, y: 2, tool: "eraser" });
    a.emit("canvas:pointer", { canvasId, x: 1, y: 2, selectedElementIds: 7 });
    // A valid one behind them proves the earlier ones were processed first.
    const valid = waitForEvent<Pointer>(b, "canvas:pointer");
    a.emit("canvas:pointer", { canvasId, x: 3, y: 4 });
    await valid;

    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("cuts an oversized selection and drops non-string ids", async () => {
    const a = await joinCanvas(owner);
    const b = await joinCanvas(peer);

    const received = waitForEvent<Pointer>(b, "canvas:pointer");
    a.emit("canvas:pointer", {
      canvasId,
      x: 0,
      y: 0,
      selectedElementIds: [
        ...Array.from({ length: 300 }, (_, i) => `id-${i}`),
        42,
        "x".repeat(65),
      ],
    });

    const pointer = await received;
    expect(pointer.selectedElementIds).toHaveLength(200);
    expect(pointer.selectedElementIds).not.toContain(42);
  });

  it("announces the pointer gone when a socket leaves the canvas", async () => {
    const a = await joinCanvas(owner);
    const b = await joinCanvas(peer);

    const gone = waitForEvent<{ canvasId: string; socketId: string }>(
      b,
      "canvas:pointer-leave",
    );
    a.emit("canvas:leave", canvasId);

    await expect(gone).resolves.toEqual({ canvasId, socketId: a.id });
  });

  it("announces the pointer gone when a socket disconnects", async () => {
    const a = await joinCanvas(owner);
    const b = await joinCanvas(peer);
    const socketId = a.id;

    const gone = waitForEvent<{ canvasId: string; socketId: string }>(
      b,
      "canvas:pointer-leave",
    );
    a.close();

    await expect(gone).resolves.toEqual({ canvasId, socketId });
  });

  it("refuses a pointer from a socket that has not joined the canvas", async () => {
    const member = await joinCanvas(owner);
    const stranger = await open(peer);
    const seen = vi.fn();
    member.on("canvas:pointer", seen);

    const failure = waitForEvent<string>(stranger, "canvas:error");
    stranger.emit("canvas:pointer", { canvasId, x: 1, y: 1 });

    await expect(failure).resolves.toBe("Not joined to canvas");
    expect(seen).not.toHaveBeenCalled();
  });

  it("refuses a pointer from a non-member, who cannot join the room", async () => {
    const outsider = await mintUser(app);
    const member = await joinCanvas(owner);
    const socket = await open(outsider);
    const seen = vi.fn();
    member.on("canvas:pointer", seen);

    const joinFailure = waitForEvent<string>(socket, "canvas:error");
    socket.emit("canvas:join", canvasId);
    await expect(joinFailure).resolves.toBe("Not a member");

    const failure = waitForEvent<string>(socket, "canvas:error");
    socket.emit("canvas:pointer", { canvasId, x: 1, y: 1 });

    await expect(failure).resolves.toBe("Not joined to canvas");
    expect(seen).not.toHaveBeenCalled();
  });

  it("does not announce a leave for a canvas the socket never joined", async () => {
    const member = await joinCanvas(owner);
    const stranger = await open(peer);
    const seen = vi.fn();
    member.on("canvas:pointer-leave", seen);

    stranger.emit("canvas:leave", canvasId);
    // A later, joined peer leaving proves the earlier leave was handled.
    const b = await joinCanvas(peer);
    const gone = waitForEvent(member, "canvas:pointer-leave");
    b.emit("canvas:leave", canvasId);
    await gone;

    expect(seen).toHaveBeenCalledTimes(1);
  });
});
