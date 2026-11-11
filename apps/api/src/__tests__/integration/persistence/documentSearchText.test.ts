/**
 * @module api/__tests__/integration/persistence/documentSearchText
 * @description The plain text kept for keyword search is rewritten on every
 * snapshot of a live document: a Yjs tree for markdown, the element array for
 * a canvas. Real server, real Postgres and Redis; the leave-triggered snapshot
 * is used for most cases so they do not each wait out a debounce, and one case
 * waits the real debounce.
 *
 * @important Each test ends only after the snapshot it provoked has landed in
 *            the database, so no write is in flight at teardown.
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
import { searchDocuments } from "../../../lib/documentSearch";
import { canvases } from "../../../socket/canvas";
import { docs } from "../../../socket/document";
import {
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

const waitFor = async (
  done: () => Promise<boolean>,
  label: string,
  timeoutMs = 10_000,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await done()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

/** Adds a paragraph to the editor's fragment and returns the diff to ship. */
const writeParagraph = (local: Y.Doc, words: string) => {
  const before = Y.encodeStateVector(local);
  const root = local.getXmlFragment("prosemirror");
  const paragraph = new Y.XmlElement("paragraph");
  root.insert(root.length, [paragraph]);
  const text = new Y.XmlText();
  paragraph.insert(0, [text]);
  text.insert(0, words);
  return Array.from(Y.encodeStateAsUpdate(local, before));
};

describe("persistence: document search text", () => {
  let server: TestServer;
  let owner: TestUser;
  let wsId: string;

  const open = async () => {
    const socket = connectClient(server.url, { Cookie: owner.cookie });
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

  const stored = (id: string) =>
    testPrisma.document.findUniqueOrThrow({ where: { id } });

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
    canvases.clear();
  });

  beforeEach(async () => {
    await resetDatabase();
    docs.clear();
    canvases.clear();
    owner = await mintUser(app);
    wsId = (await createWorkspace(owner.id)).id;
  });

  describe("markdown", () => {
    it("stores the paragraph text when the last editor leaves", async () => {
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        title: "Runbook",
      });
      const socket = await open();
      const local = await joinDoc(socket, doc.id);

      socket.emit(
        "doc:update",
        doc.id,
        writeParagraph(local, "restart the pump"),
      );
      socket.emit(
        "doc:update",
        doc.id,
        writeParagraph(local, "check the valve"),
      );
      socket.emit("doc:leave", doc.id);

      await waitFor(
        async () => (await stored(doc.id)).yjsState !== null,
        "the snapshot",
      );
      expect((await stored(doc.id)).searchText).toBe(
        "restart the pump\ncheck the valve",
      );
      await expect(searchDocuments(wsId, "valve")).resolves.toMatchObject([
        { documentId: doc.id, title: "Runbook" },
      ]);
    });

    it("stores it on the debounced write too", async () => {
      const doc = await createDocument(wsId, { type: "MARKDOWN" });
      const socket = await open();
      const local = await joinDoc(socket, doc.id);

      socket.emit(
        "doc:update",
        doc.id,
        writeParagraph(local, "debounced words"),
      );

      await waitFor(
        async () => (await stored(doc.id)).searchText === "debounced words",
        "the debounced write",
        9_000,
      );
    }, 20_000);

    it("keeps the text of an AI seed the editor has not consumed yet", async () => {
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        initialContent: "# Seed\n\nseeded words",
        searchText: "Seed\nseeded words",
      });
      const socket = await open();
      await joinDoc(socket, doc.id);

      // A snapshot of the still-empty tree must not erase the seed's text.
      socket.emit("doc:leave", doc.id);
      await waitFor(
        async () => (await stored(doc.id)).yjsState !== null,
        "the snapshot",
      );

      expect((await stored(doc.id)).searchText).toBe("Seed\nseeded words");
    });

    it("clears the text when the editor removed everything", async () => {
      const doc = await createDocument(wsId, {
        type: "MARKDOWN",
        searchText: "stale words",
      });
      const socket = await open();
      await joinDoc(socket, doc.id);

      socket.emit("doc:leave", doc.id);
      await waitFor(
        async () => (await stored(doc.id)).yjsState !== null,
        "the snapshot",
      );

      expect((await stored(doc.id)).searchText).toBeNull();
    });
  });

  describe("canvas", () => {
    const openCanvas = async (socket: ClientSocket, canvasId: string) => {
      const state = waitForEvent(socket, "canvas:state");
      socket.emit("canvas:join", canvasId);
      await state;
    };

    it("stores the text of its text elements on leave", async () => {
      const canvas = await createDocument(wsId, {
        type: "CANVAS",
        title: "Board",
      });
      const socket = await open();
      await openCanvas(socket, canvas.id);

      socket.emit("canvas:update", {
        documentId: canvas.id,
        elements: [
          { id: "a", type: "rectangle" },
          { id: "b", type: "text", text: "Gateway", containerId: "a" },
          { id: "c", type: "text", text: "removed", isDeleted: true },
        ],
      });
      socket.emit("canvas:leave", canvas.id);

      await waitFor(
        async () => (await stored(canvas.id)).searchText !== null,
        "the snapshot",
      );
      expect((await stored(canvas.id)).searchText).toBe("Gateway");
      await expect(searchDocuments(wsId, "gateway")).resolves.toHaveLength(1);
      await expect(searchDocuments(wsId, "removed")).resolves.toHaveLength(0);
    });

    it("clears the text when the canvas is emptied on purpose", async () => {
      const canvas = await createDocument(wsId, {
        type: "CANVAS",
        searchText: "old label",
        canvasData: [{ id: "t", type: "text", text: "old label" }],
      });
      const socket = await open();
      await openCanvas(socket, canvas.id);

      socket.emit("canvas:update", {
        documentId: canvas.id,
        elements: [],
        initialized: true,
      });
      socket.emit("canvas:leave", canvas.id);

      await waitFor(
        async () => (await stored(canvas.id)).searchText === null,
        "the cleared text",
      );
    });
  });

  it("matches a renamed title without any application write to the search column", async () => {
    const doc = await createDocument(wsId, {
      type: "MARKDOWN",
      title: "Old name",
      searchText: "body",
    });
    await testPrisma.document.update({
      where: { id: doc.id },
      data: { title: "Quarterly roadmap" },
    });

    await expect(searchDocuments(wsId, "roadmap")).resolves.toHaveLength(1);
    await expect(searchDocuments(wsId, "old")).resolves.toHaveLength(0);
  });
});
