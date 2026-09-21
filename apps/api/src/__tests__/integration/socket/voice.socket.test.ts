/**
 * @module api/__tests__/integration/socket/voice
 * @description WebRTC signalling and voice presence.
 *
 * Only signalling is exercised — the media path never touches the server, so
 * there is nothing else to test here. Assertions cover the 1:1 relay (offers,
 * answers, ICE candidates must reach exactly one peer) and the Redis roster.
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
} from "vitest";
import { createApp } from "../../../app";
import { voicePresenceService } from "../../../lib/voicePresence";
import {
  addMember,
  closeTestResources,
  connectClient,
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

/** Joins the voice channel and waits for the joiner's roster replay. */
const joinVoice = async (socket: ClientSocket, workspaceId: string) => {
  const roster = waitForEvent<{ users: unknown[] }>(
    socket,
    "voice:current-users",
  );
  socket.emit("voice:join", workspaceId);
  return roster;
};

describe("socket: voice", () => {
  let server: TestServer;
  let alice: TestUser;
  let bob: TestUser;
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
  });

  beforeEach(async () => {
    await resetDatabase();
    alice = await mintUser(app);
    bob = await mintUser(app);

    wsId = (await createWorkspace(alice.id)).id;
    await addMember(wsId, bob.id, "MEMBER");
  });

  describe("presence", () => {
    it("registers a joiner in the roster, starting muted", async () => {
      const socket = await openSocket(server, alice);
      await joinVoice(socket, wsId);

      const roster = await voicePresenceService.getVoiceUsers(wsId);
      expect(roster).toHaveLength(1);
      expect(roster[0]).toMatchObject({ userId: alice.id, isMuted: true });
    });

    it("excludes the joiner from the roster it replays", async () => {
      const aliceSocket = await openSocket(server, alice);
      await joinVoice(aliceSocket, wsId);

      const bobSocket = await openSocket(server, bob);
      const roster = await joinVoice(bobSocket, wsId);

      // The joiner opens one peer connection per entry, so it must not see itself.
      expect(roster.users).toHaveLength(1);
      expect(roster.users[0]).toMatchObject({ userId: alice.id });
    });

    it("announces a joiner to those already in the channel", async () => {
      const aliceSocket = await openSocket(server, alice);
      await joinVoice(aliceSocket, wsId);

      const announcement = waitForEvent<{ userId: string; name: string }>(
        aliceSocket,
        "voice:user-joined",
      );
      const bobSocket = await openSocket(server, bob);
      await joinVoice(bobSocket, wsId);

      await expect(announcement).resolves.toMatchObject({
        userId: bob.id,
        name: bob.name,
      });
    });

    it("removes a leaver from the roster and tells the room", async () => {
      const aliceSocket = await openSocket(server, alice);
      await joinVoice(aliceSocket, wsId);
      const bobSocket = await openSocket(server, bob);
      await joinVoice(bobSocket, wsId);

      const departure = waitForEvent<{ userId: string }>(
        bobSocket,
        "voice:user-left",
      );
      aliceSocket.emit("voice:leave", wsId);

      await expect(departure).resolves.toMatchObject({ userId: alice.id });
      await expect(
        voicePresenceService.getVoiceUsers(wsId),
      ).resolves.toHaveLength(1);
    });

    it("clears the roster when a socket disconnects abruptly", async () => {
      const socket = await openSocket(server, alice);
      await joinVoice(socket, wsId);

      socket.close();
      await new Promise((resolve) => setTimeout(resolve, 350));

      await expect(
        voicePresenceService.getVoiceUsers(wsId),
      ).resolves.toHaveLength(0);
    });

    it("ignores a non-member trying to join", async () => {
      const outsider = await mintUser(app);
      const socket = await openSocket(server, outsider);

      socket.emit("voice:join", wsId);
      await new Promise((resolve) => setTimeout(resolve, 300));

      await expect(
        voicePresenceService.getVoiceUsers(wsId),
      ).resolves.toHaveLength(0);
    });
  });

  describe("signalling relay", () => {
    beforeEach(async () => {
      const aliceSocket = await openSocket(server, alice);
      await joinVoice(aliceSocket, wsId);
      const bobSocket = await openSocket(server, bob);
      await joinVoice(bobSocket, wsId);
    });

    it("delivers an offer to exactly the target peer, stamped with the sender", async () => {
      const [aliceSocket, bobSocket] = openSockets;
      const offer = { type: "offer", sdp: "v=0 alice" };

      const relayed = waitForEvent<{ fromUserId: string; offer: unknown }>(
        bobSocket!,
        "voice:offer",
      );
      aliceSocket!.emit("voice:offer", {
        workspaceId: wsId,
        targetUserId: bob.id,
        offer,
      });

      await expect(relayed).resolves.toMatchObject({ fromUserId: alice.id });
    });

    it("does not echo a peer's own signalling back to it", async () => {
      const [aliceSocket] = openSockets;
      const echoed: unknown[] = [];
      aliceSocket!.on("voice:offer", (payload) => echoed.push(payload));

      aliceSocket!.emit("voice:offer", {
        workspaceId: wsId,
        targetUserId: bob.id,
        offer: { type: "offer", sdp: "v=0" },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(echoed).toEqual([]);
    });

    it("relays an answer to the target peer", async () => {
      const [aliceSocket, bobSocket] = openSockets;

      const relayed = waitForEvent<{ fromUserId: string }>(
        aliceSocket!,
        "voice:answer",
      );
      bobSocket!.emit("voice:answer", {
        workspaceId: wsId,
        targetUserId: alice.id,
        answer: { type: "answer", sdp: "v=0 bob" },
      });

      await expect(relayed).resolves.toMatchObject({ fromUserId: bob.id });
    });

    it("relays an ICE candidate to the target peer", async () => {
      const [aliceSocket, bobSocket] = openSockets;

      const relayed = waitForEvent<{ fromUserId: string; candidate: unknown }>(
        bobSocket!,
        "voice:ice-candidate",
      );
      aliceSocket!.emit("voice:ice-candidate", {
        workspaceId: wsId,
        targetUserId: bob.id,
        candidate: { candidate: "candidate:1", sdpMid: "0" },
      });

      await expect(relayed).resolves.toMatchObject({ fromUserId: alice.id });
    });

    it("silently drops signalling aimed at an offline peer", async () => {
      const [aliceSocket, bobSocket] = openSockets;
      bobSocket!.close();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Must not throw or crash the server.
      aliceSocket!.emit("voice:offer", {
        workspaceId: wsId,
        targetUserId: bob.id,
        offer: { type: "offer", sdp: "v=0" },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(aliceSocket!.connected).toBe(true);
    });

    it("silently drops an ICE candidate aimed at an offline peer", async () => {
      const [aliceSocket, bobSocket] = openSockets;
      bobSocket!.close();
      await new Promise((resolve) => setTimeout(resolve, 200));

      aliceSocket!.emit("voice:ice-candidate", {
        workspaceId: wsId,
        targetUserId: bob.id,
        candidate: { candidate: "candidate:1", sdpMid: "0" },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(aliceSocket!.connected).toBe(true);
    });

    it("silently drops an answer aimed at an offline peer", async () => {
      const [aliceSocket, bobSocket] = openSockets;
      bobSocket!.close();
      await new Promise((resolve) => setTimeout(resolve, 200));

      aliceSocket!.emit("voice:answer", {
        workspaceId: wsId,
        targetUserId: bob.id,
        answer: { type: "answer", sdp: "v=0" },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(aliceSocket!.connected).toBe(true);
    });
  });

  describe("mute state", () => {
    it("broadcasts a mute change and persists it in the roster", async () => {
      const aliceSocket = await openSocket(server, alice);
      await joinVoice(aliceSocket, wsId);
      const bobSocket = await openSocket(server, bob);
      await joinVoice(bobSocket, wsId);

      const broadcast = waitForEvent<{ userId: string; isMuted: boolean }>(
        bobSocket,
        "voice:mute-state",
      );
      aliceSocket.emit("voice:mute-state", {
        workspaceId: wsId,
        isMuted: false,
      });

      await expect(broadcast).resolves.toMatchObject({
        userId: alice.id,
        isMuted: false,
      });

      const roster = await voicePresenceService.getVoiceUsers(wsId);
      expect(roster.find((u) => u.userId === alice.id)?.isMuted).toBe(false);
      // The other participant's state is untouched.
      expect(roster.find((u) => u.userId === bob.id)?.isMuted).toBe(true);
    });
  });
});
