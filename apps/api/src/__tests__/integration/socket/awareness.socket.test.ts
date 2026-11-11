/**
 * @module api/__tests__/integration/socket/awareness
 * @description Cursor presence on markdown documents: the relay between
 * members, the replay a newcomer receives, cleanup on leave and disconnect,
 * refusal of sockets outside the room, and the size, ownership and identity
 * rules that keep a client from presenting itself as someone else.
 *
 * Each simulated browser is a real `Awareness` over a local `Y.Doc`, driven
 * through the same encode/apply calls the web editor uses, so the server's
 * framing assumptions are tested against genuine y-protocols output.
 */
import type { Socket as ClientSocket } from "socket.io-client";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
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
import { presenceColor } from "@nimbus/utils";
import { createApp } from "../../../app";
import { encodeAwarenessEntries } from "../../../lib/awareness";
import { docs, presence } from "../../../socket/document";
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

/** One simulated browser tab on a document. */
type Tab = { socket: ClientSocket; doc: Y.Doc; awareness: Awareness };

/** A cursor in the shape y-prosemirror publishes. */
const cursor = () => ({
  anchor: { type: null, tname: "prosemirror", item: null, assoc: 0 },
  head: { type: null, tname: "prosemirror", item: null, assoc: 0 },
});

/** Everyone in this tab's awareness except the tab itself. */
const remotes = (tab: Tab) =>
  [...tab.awareness.getStates()].filter(([id]) => id !== tab.doc.clientID);

describe("socket: document awareness", () => {
  let server: TestServer;
  let owner: TestUser;
  let peer: TestUser;
  let wsId: string;
  let docId: string;

  const open = async (user: TestUser): Promise<ClientSocket> => {
    const socket = connectClient(server.url, { Cookie: user.cookie });
    await waitForEvent(socket, "connect");
    openSockets.push(socket);
    return socket;
  };

  /** Opens a tab and joins the document, applying awareness as the editor does. */
  const joinTab = async (user: TestUser, id = docId): Promise<Tab> => {
    const socket = await open(user);
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    socket.on("doc:awareness", (_docId: string, update: number[]) => {
      applyAwarenessUpdate(awareness, Uint8Array.from(update), "socket");
    });

    const state = waitForEvent(socket, "doc:state");
    socket.emit("doc:join", id);
    await state;
    return { socket, doc, awareness };
  };

  /** Sends this tab's own awareness state, as the editor does after joining. */
  const publish = (tab: Tab, id = docId) => {
    // A fresh awareness is at clock 0, which the server rightly ignores; a real
    // editor always changes its state (user, cursor) before the first send.
    tab.awareness.setLocalStateField(
      "cursor",
      tab.awareness.getLocalState()?.cursor ?? null,
    );
    tab.socket.emit(
      "doc:awareness",
      id,
      Array.from(encodeAwarenessUpdate(tab.awareness, [tab.doc.clientID])),
    );
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
    await vi.waitFor(() => expect(docs.size).toBe(0), { timeout: 5_000 });
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

  describe("relaying", () => {
    it("shows one member's cursor to another", async () => {
      const a = await joinTab(owner);
      const b = await joinTab(peer);

      a.awareness.setLocalStateField("cursor", cursor());
      publish(a);

      await vi.waitFor(() => expect(remotes(b)).toHaveLength(1));
      const [clientId, state] = remotes(b)[0]!;
      expect(clientId).toBe(a.doc.clientID);
      expect(state.cursor).toEqual(cursor());
    });

    it("stamps identity from the session and ignores what the client claims", async () => {
      const a = await joinTab(owner);
      const b = await joinTab(peer);

      a.awareness.setLocalStateField("user", {
        userId: peer.id,
        name: "Somebody Else",
        color: "#000000",
      });
      a.awareness.setLocalStateField("extra", "x".repeat(1_000));
      publish(a);

      await vi.waitFor(() => expect(remotes(b)).toHaveLength(1));
      const state = remotes(b)[0]![1];
      expect(state.user).toMatchObject({
        userId: owner.id,
        name: owner.name,
        color: presenceColor(owner.id),
      });
      expect(state.extra).toBeUndefined();
    });

    it("does not echo an update back to its sender", async () => {
      const a = await joinTab(owner);
      const b = await joinTab(peer);
      const echoed = vi.fn();
      a.socket.on("doc:awareness", echoed);

      b.awareness.setLocalStateField("cursor", cursor());
      publish(b);
      await vi.waitFor(() => expect(remotes(a)).toHaveLength(1));

      a.awareness.setLocalStateField("cursor", cursor());
      publish(a);
      await vi.waitFor(() => expect(remotes(b)).toHaveLength(1));

      // `a` received `b`'s update only; nothing came back for its own.
      expect(echoed).toHaveBeenCalledTimes(1);
    });

    it("replays existing states to a newcomer on join", async () => {
      const a = await joinTab(owner);
      a.awareness.setLocalStateField("cursor", cursor());
      publish(a);

      const server1 = await vi.waitFor(() => {
        const entry = presence.get(docId);
        expect(entry?.awareness.getStates().has(a.doc.clientID)).toBe(true);
        return entry!;
      });
      expect(server1.owners.get(a.doc.clientID)?.userId).toBe(owner.id);

      const b = await joinTab(peer);
      await vi.waitFor(() => expect(remotes(b)).toHaveLength(1));
      expect(remotes(b)[0]![1].user).toMatchObject({ userId: owner.id });
    });

    it("never lists the server itself as a collaborator", async () => {
      const a = await joinTab(owner);
      publish(a);
      await vi.waitFor(() =>
        expect(presence.get(docId)?.awareness.getStates().size).toBe(1),
      );

      const states = presence.get(docId)!.awareness.getStates();
      expect([...states.keys()]).toEqual([a.doc.clientID]);
    });
  });

  describe("leaving and disconnecting", () => {
    it("removes a socket's cursors and tells the room when it leaves", async () => {
      const a = await joinTab(owner);
      const b = await joinTab(peer);
      publish(a);
      await vi.waitFor(() => expect(remotes(b)).toHaveLength(1));

      a.socket.emit("doc:leave", docId);

      await vi.waitFor(() => expect(remotes(b)).toHaveLength(0));
      expect(
        presence.get(docId)?.awareness.getStates().has(a.doc.clientID),
      ).toBe(false);
      expect(presence.get(docId)?.owners.size).toBe(0);
    });

    it("removes a socket's cursors and tells the room when it disconnects", async () => {
      const a = await joinTab(owner);
      const b = await joinTab(peer);
      publish(a);
      await vi.waitFor(() => expect(remotes(b)).toHaveLength(1));

      a.socket.close();

      await vi.waitFor(() => expect(remotes(b)).toHaveLength(0));
      expect(presence.get(docId)?.owners.size).toBe(0);
    });

    it("removes only the departing socket's cursors", async () => {
      const a = await joinTab(owner);
      const b = await joinTab(peer);
      const c = await joinTab(owner);
      publish(a);
      publish(b);
      await vi.waitFor(() => expect(remotes(c)).toHaveLength(2));

      a.socket.close();

      await vi.waitFor(() => expect(remotes(c)).toHaveLength(1));
      expect(remotes(c)[0]![0]).toBe(b.doc.clientID);
    });

    it("destroys the awareness when the last socket leaves and the document is evicted", async () => {
      const a = await joinTab(owner);
      publish(a);
      await vi.waitFor(() => expect(presence.has(docId)).toBe(true));
      const awareness = presence.get(docId)!.awareness;
      const destroyed = vi.fn();
      awareness.on("destroy", destroyed);

      a.socket.emit("doc:leave", docId);

      await vi.waitFor(() => expect(docs.has(docId)).toBe(false));
      expect(presence.has(docId)).toBe(false);
      expect(destroyed).toHaveBeenCalledTimes(1);
    });

    it("keeps presence while another member remains", async () => {
      const a = await joinTab(owner);
      const b = await joinTab(peer);
      publish(b);
      await vi.waitFor(() => expect(remotes(a)).toHaveLength(1));

      a.socket.emit("doc:leave", docId);
      await vi.waitFor(() =>
        expect(presence.get(docId)?.owners.get(b.doc.clientID)?.userId).toBe(
          peer.id,
        ),
      );
      expect(docs.has(docId)).toBe(true);
    });
  });

  describe("refusals", () => {
    it("refuses a socket that has not joined the document", async () => {
      const socket = await open(owner);
      const doc = new Y.Doc();
      const awareness = new Awareness(doc);

      const failure = waitForEvent<string>(socket, "doc:error");
      socket.emit(
        "doc:awareness",
        docId,
        Array.from(encodeAwarenessUpdate(awareness, [doc.clientID])),
      );

      await expect(failure).resolves.toBe("Not joined to document");
      expect(presence.has(docId)).toBe(false);
    });

    it("refuses a non-member, who can never join the room", async () => {
      const outsider = await mintUser(app);
      const member = await joinTab(owner);
      const socket = await open(outsider);
      const doc = new Y.Doc();
      const awareness = new Awareness(doc);
      const seen = vi.fn();
      member.socket.on("doc:awareness", seen);

      const joinFailure = waitForEvent<string>(socket, "doc:error");
      socket.emit("doc:join", docId);
      await expect(joinFailure).resolves.toBe("Not a member");

      const failure = waitForEvent<string>(socket, "doc:error");
      socket.emit(
        "doc:awareness",
        docId,
        Array.from(encodeAwarenessUpdate(awareness, [doc.clientID])),
      );

      await expect(failure).resolves.toBe("Not joined to document");
      expect(seen).not.toHaveBeenCalled();
    });

    it("refuses an update above 64 KB", async () => {
      const a = await joinTab(owner);
      const b = await joinTab(peer);
      const seen = vi.fn();
      b.socket.on("doc:awareness", seen);

      const failure = waitForEvent<string>(a.socket, "doc:error");
      a.socket.emit("doc:awareness", docId, new Array(64 * 1024 + 1).fill(0));

      await expect(failure).resolves.toBe("Awareness update too large");
      expect(seen).not.toHaveBeenCalled();
    });

    it("refuses bytes that are not an awareness update", async () => {
      const a = await joinTab(owner);

      const failure = waitForEvent<string>(a.socket, "doc:error");
      a.socket.emit("doc:awareness", docId, [1, 200, 3, 4, 5]);

      await expect(failure).resolves.toBe("Malformed awareness update");
    });

    it("refuses to let one user take over another user's client id", async () => {
      const a = await joinTab(owner);
      const b = await joinTab(peer);
      publish(a);
      await vi.waitFor(() => expect(remotes(b)).toHaveLength(1));

      const failure = waitForEvent<string>(b.socket, "doc:error");
      b.socket.emit(
        "doc:awareness",
        docId,
        Array.from(
          encodeAwarenessEntries([
            { clientId: a.doc.clientID, clock: 999, state: { cursor: null } },
          ]),
        ),
      );

      await expect(failure).resolves.toBe("Awareness client id in use");
      expect(presence.get(docId)?.owners.get(a.doc.clientID)?.socketId).toBe(
        a.socket.id,
      );
    });

    it("refuses an update claiming more client ids than a tab needs", async () => {
      const a = await joinTab(owner);

      const failure = waitForEvent<string>(a.socket, "doc:error");
      a.socket.emit(
        "doc:awareness",
        docId,
        Array.from(
          encodeAwarenessEntries(
            Array.from({ length: 9 }, (_, i) => ({
              clientId: 1_000 + i,
              clock: 1,
              state: { cursor: null },
            })),
          ),
        ),
      );

      await expect(failure).resolves.toBe("Malformed awareness update");
    });
  });

  describe("one user in two sessions", () => {
    it("lets a reconnecting session take over its own client id", async () => {
      const first = await joinTab(owner);
      const watcher = await joinTab(peer);
      publish(first);
      await vi.waitFor(() => expect(remotes(watcher)).toHaveLength(1));

      // A second socket for the same user re-announces the same client id
      // before the first socket has been noticed as gone.
      const second = await joinTab(owner);
      Object.assign(second.doc, { clientID: first.doc.clientID });
      second.awareness.setLocalStateField("cursor", cursor());
      second.socket.emit(
        "doc:awareness",
        docId,
        Array.from(
          encodeAwarenessEntries([
            {
              clientId: first.doc.clientID,
              clock: 50,
              state: { cursor: cursor() },
            },
          ]),
        ),
      );

      await vi.waitFor(() =>
        expect(
          presence.get(docId)?.owners.get(first.doc.clientID)?.socketId,
        ).toBe(second.socket.id),
      );

      // The old socket dropping must not remove what the new one now owns.
      first.socket.close();
      await vi.waitFor(() => expect(docs.has(docId)).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(
        presence.get(docId)?.awareness.getStates().has(first.doc.clientID),
      ).toBe(true);
    });
  });
});
