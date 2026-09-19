/**
 * @module api/__tests__/integration/socket/yjs.convergence
 * @description CRDT correctness for the markdown editor pipeline: concurrent
 * edits from independent clients converge, late joiners receive the full merged
 * state, and the server's own `Y.Doc` reflects both sides.
 *
 * Convergence is the whole reason Yjs is here, so these assert on the *merged
 * result*, not on message plumbing (covered in document.socket.test.ts).
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

/** Joins a document, returning a local Y.Doc hydrated from the server. */
const joinDoc = async (socket: ClientSocket, docId: string) => {
  const state = waitForEvent<number[]>(socket, "doc:state");
  socket.emit("doc:join", docId);

  const local = new Y.Doc();
  Y.applyUpdate(local, Uint8Array.from(await state));
  return local;
};

/**
 * Applies a local edit and ships it, mirroring what a real editor does: the
 * change is applied locally (the server does not echo it back to the sender).
 *
 * @important The state vector must be captured *before* the insert — taking it
 *            afterwards makes the diff relative to the already-edited state, so
 *            the update carries nothing and the server never sees the change.
 */
const edit = (socket: ClientSocket, docId: string, local: Y.Doc, text: string) => {
  const beforeEdit = Y.encodeStateVector(local);

  local.getText("content").insert(local.getText("content").length, text);
  socket.emit("doc:update", docId, Array.from(Y.encodeStateAsUpdate(local, beforeEdit)));
};

const textOf = (doc: Y.Doc) => doc.getText("content").toString();

describe("socket: yjs convergence", () => {
  let server: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let wsId: string;
  let docId: string;

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

    alice = await mintUser(app);
    bob = await mintUser(app);

    wsId = (await createWorkspace(alice.id)).id;
    await addMember(wsId, bob.id, "MEMBER");
    docId = (await createDocument(wsId, { type: "MARKDOWN" })).id;
  });

  it("converges on the server's document when two clients edit concurrently", async () => {
    const aliceSocket = await openSocket(server, alice);
    const aliceDoc = await joinDoc(aliceSocket, docId);
    const bobSocket = await openSocket(server, bob);
    const bobDoc = await joinDoc(bobSocket, docId);

    // Both edit before either hears from the other — a genuine concurrent write.
    edit(aliceSocket, docId, aliceDoc, "from alice. ");
    edit(bobSocket, docId, bobDoc, "from bob.");

    await new Promise((resolve) => setTimeout(resolve, 500));

    const onServer = docs.get(docId);
    expect(onServer).toBeDefined();

    // Both fragments must be present exactly once, in some consistent order.
    const merged = textOf(onServer!);
    expect(merged).toContain("from alice. ");
    expect(merged).toContain("from bob.");
    expect(merged.length).toBe("from alice. ".length + "from bob.".length);
  });

  it("lets a late joiner receive the fully merged state", async () => {
    const aliceSocket = await openSocket(server, alice);
    const aliceDoc = await joinDoc(aliceSocket, docId);
    const bobSocket = await openSocket(server, bob);
    const bobDoc = await joinDoc(bobSocket, docId);

    edit(aliceSocket, docId, aliceDoc, "alpha ");
    edit(bobSocket, docId, bobDoc, "beta");
    await new Promise((resolve) => setTimeout(resolve, 400));

    const carol = await mintUser(app);
    await addMember(wsId, carol.id, "MEMBER");
    const carolSocket = await openSocket(server, carol);
    const carolDoc = await joinDoc(carolSocket, docId);

    expect(textOf(carolDoc)).toContain("alpha ");
    expect(textOf(carolDoc)).toContain("beta");
  });

  it("converges the clients against each other, not just against the server", async () => {
    const aliceSocket = await openSocket(server, alice);
    const aliceDoc = await joinDoc(aliceSocket, docId);
    const bobSocket = await openSocket(server, bob);
    const bobDoc = await joinDoc(bobSocket, docId);

    // Bob listens for Alice's update and applies it, as a real client would.
    bobSocket.on("doc:update", (update: number[]) => {
      Y.applyUpdate(bobDoc, Uint8Array.from(update));
    });

    edit(aliceSocket, docId, aliceDoc, "alice-only");
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(textOf(bobDoc)).toBe("alice-only");
  });

  it("does not lose an edit applied to a server-side doc that was never seeded", async () => {
    const socket = await openSocket(server, alice);
    const local = await joinDoc(socket, docId);

    edit(socket, docId, local, "first ever edit");
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(textOf(docs.get(docId)!)).toBe("first ever edit");
  });
});
