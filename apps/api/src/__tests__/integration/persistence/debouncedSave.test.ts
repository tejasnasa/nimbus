/**
 * @module api/__tests__/integration/persistence/debouncedSave
 * @description The debounced Yjs persistence path.
 *
 * Live edits are held in memory and flushed to Postgres on a 5s timer, so the
 * property that matters is that a burst of edits coalesces into a flush that
 * still contains *all* of them — no edit may be lost to the debounce.
 *
 * Real timers are used deliberately: the debounce is scheduled with `setTimeout`
 * inside the server, and faking timers in the test process would not advance it.
 * The 5s constant is read from the module's documented behaviour, not hardcoded
 * here beyond the wait.
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

/** The document debounce interval, plus slack for the async write. */
const DEBOUNCE_WINDOW_MS = 5_000;
const FLUSH_WAIT_MS = DEBOUNCE_WINDOW_MS + 1_500;

const openSockets: ClientSocket[] = [];

const openSocket = async (server: TestServer, user: TestUser) => {
  const socket = connectClient(server.url, { Cookie: user.cookie });
  await waitForEvent(socket, "connect");
  openSockets.push(socket);
  return socket;
};

const joinDoc = async (socket: ClientSocket, docId: string) => {
  const state = waitForEvent<number[]>(socket, "doc:state");
  socket.emit("doc:join", docId);

  const local = new Y.Doc();
  Y.applyUpdate(local, Uint8Array.from(await state));
  return local;
};

/** Ships a local edit as a diff taken against the pre-edit state vector. */
const edit = (socket: ClientSocket, docId: string, local: Y.Doc, text: string) => {
  const beforeEdit = Y.encodeStateVector(local);
  local.getText("content").insert(local.getText("content").length, text);
  socket.emit("doc:update", docId, Array.from(Y.encodeStateAsUpdate(local, beforeEdit)));
};

const persistedText = async (docId: string) => {
  const stored = await testPrisma.document.findUnique({ where: { id: docId } });
  const doc = new Y.Doc();
  if (stored?.yjsState) Y.applyUpdate(doc, stored.yjsState);
  return doc.getText("content").toString();
};

describe("persistence: debounced document save", () => {
  let server: TestServer;
  let owner: TestUser;
  let peer: TestUser;
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

    owner = await mintUser(app);
    peer = await mintUser(app);

    wsId = (await createWorkspace(owner.id)).id;
    await addMember(wsId, peer.id, "MEMBER");
    docId = (await createDocument(wsId, { type: "MARKDOWN" })).id;
  });

  it("flushes a burst of edits only after the quiet period", async () => {
    const socket = await openSocket(server, owner);
    const local = await joinDoc(socket, docId);

    edit(socket, docId, local, "one ");
    edit(socket, docId, local, "two ");
    edit(socket, docId, local, "three");

    // Immediately after the burst nothing should have been written yet.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(persistedText(docId)).resolves.toBe("");

    // After the debounce window the coalesced write lands, with every edit.
    await new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));
    await expect(persistedText(docId)).resolves.toBe("one two three");
  }, 20_000);

  it("keeps edits from two clients in the flushed snapshot", async () => {
    const ownerSocket = await openSocket(server, owner);
    const ownerDoc = await joinDoc(ownerSocket, docId);
    const peerSocket = await openSocket(server, peer);
    const peerDoc = await joinDoc(peerSocket, docId);

    edit(ownerSocket, docId, ownerDoc, "alice ");
    edit(peerSocket, docId, peerDoc, "bob");

    await new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));

    const persisted = await persistedText(docId);
    expect(persisted).toContain("alice ");
    expect(persisted).toContain("bob");
  }, 20_000);

  it("does not persist anything when nothing was edited", async () => {
    const socket = await openSocket(server, owner);
    await joinDoc(socket, docId);

    await new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));

    const stored = await testPrisma.document.findUnique({ where: { id: docId } });
    expect(stored?.yjsState).toBeNull();
  }, 20_000);
});
