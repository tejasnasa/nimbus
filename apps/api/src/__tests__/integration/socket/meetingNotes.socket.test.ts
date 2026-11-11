/**
 * @module api/__tests__/integration/socket/meetingNotes.socket
 * @description What a workspace hears when notes are written and when action
 * items or meetings change: `meeting:notes-ready`, `meeting:action-items`, the
 * NimbusBot chat message with the notes link, and `meeting:deleted`. Real
 * sockets, Postgres and Redis (the adapter publishes every broadcast); the
 * model is a stub.
 *
 * Each test waits for the last broadcast it triggers before it ends, so the
 * adapter has nothing in flight when teardown closes Redis.
 */
import type { AddressInfo } from "node:net";
import type { Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
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

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

import { createApp, createHttpServer } from "../../../app";
import { BOT_USER_EMAIL } from "../../../lib/botUser";
import { notesReadyMessage, writeNotes } from "../../../lib/meeting/notes";
import {
  addMember,
  closeTestResources,
  connectClient,
  createMeeting,
  createWorkspace,
  mintUser,
  modelReply,
  resetDatabase,
  SAMPLE_LINES,
  sampleNotes,
  seedTranscript,
  stubResolver,
  testPrisma,
  waitForEvent,
  type TestUser,
} from "@testhelpers";

type ActionItemsEvent = {
  meetingId: string | null;
  items: Array<{
    id: string;
    text: string;
    status: string;
    ownerName: string | null;
  }>;
  removedIds: string[];
};

const minting = createApp();

describe("socket: meeting notes broadcasts", () => {
  let httpServer: ReturnType<typeof createHttpServer>["httpServer"];
  let io: ReturnType<typeof createHttpServer>["io"];
  let url: string;
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let meetingId: string;
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    const created = createHttpServer();
    httpServer = created.httpServer;
    io = created.io;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await closeTestResources();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  const joined = async (user: TestUser) => {
    const socket = connectClient(url, { Cookie: user.cookie });
    await waitForEvent(socket, "connect");
    sockets.push(socket);
    socket.emit("workspace:join", workspaceId);
    await waitForEvent(socket, "presence:online_users");
    return socket;
  };

  const api = (user: TestUser) => ({
    patch: (path: string) =>
      request(url).patch(path).set("Cookie", user.cookie),
    delete: (path: string) =>
      request(url).delete(path).set("Cookie", user.cookie),
  });

  beforeEach(async () => {
    await resetDatabase();
    createMock.mockReset();
    owner = await mintUser(minting, { name: "Priya Shah" });
    member = await mintUser(minting, { name: "Tom Brandt" });
    outsider = await mintUser(minting, { name: "Otto Outsider" });
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, member.id, "MEMBER");
    meetingId = (
      await createMeeting(workspaceId, {
        startedById: owner.id,
        status: "ENDED",
        startedAt: new Date("2026-11-09T09:00:00Z"),
        endedAt: new Date(Date.now() - 5 * 60_000),
      })
    ).id;
    await seedTranscript(meetingId, SAMPLE_LINES);
  });

  it("announces the notes, the action items and a NimbusBot message with the link", async () => {
    createMock.mockResolvedValue(modelReply(sampleNotes()));
    const listener = await joined(member);
    const outsiderSocket = connectClient(url, { Cookie: outsider.cookie });
    await waitForEvent(outsiderSocket, "connect");
    sockets.push(outsiderSocket);
    const heardByOutsider = vi.fn();
    outsiderSocket.onAny(heardByOutsider);

    const ready = waitForEvent<{ meetingId: string; documentId: string }>(
      listener,
      "meeting:notes-ready",
    );
    const items = waitForEvent<ActionItemsEvent>(
      listener,
      "meeting:action-items",
    );
    const message = waitForEvent<{
      content: string;
      userId: string;
      name: string;
    }>(listener, "message:new");

    expect(
      await writeNotes(meetingId, { io, resolve: stubResolver(createMock) }),
    ).toBe("written");

    const { documentId } = await ready;
    const stored = await testPrisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });
    expect(documentId).toBe(stored.notesDocumentId);
    expect((await ready).meetingId).toBe(meetingId);

    const changed = await items;
    expect(changed.meetingId).toBe(meetingId);
    expect(changed.removedIds).toEqual([]);
    expect(changed.items.map((i) => i.text).sort()).toEqual([
      "Update the changelog",
      "Write the rollback plan",
    ]);
    expect(
      changed.items.find((i) => i.text === "Update the changelog")!.ownerName,
    ).toBe("Tom Brandt");

    const posted = await message;
    const bot = await testPrisma.user.findFirstOrThrow({
      where: { email: BOT_USER_EMAIL },
    });
    expect(posted.userId).toBe(bot.id);
    expect(posted.content).toBe(
      notesReadyMessage(
        "Beta launch planning",
        "Meeting notes: Beta launch planning (2026-11-09)",
        documentId,
      ),
    );
    expect(posted.content).toContain(`(nimbus-doc:${documentId})`);
    const stub = await testPrisma.message.findFirstOrThrow({
      where: { workspaceId, userId: bot.id },
    });
    expect(stub.content).toBe(posted.content);

    expect(heardByOutsider).not.toHaveBeenCalled();
  });

  it("announces nothing when the notes could not be written", async () => {
    createMock.mockResolvedValue(modelReply("not json"));
    const listener = await joined(member);
    const heard = vi.fn();
    listener.onAny((event: string) => {
      if (event.startsWith("meeting:") || event === "message:new") heard(event);
    });

    expect(
      await writeNotes(meetingId, { io, resolve: stubResolver(createMock) }),
    ).toBe("failed");

    expect(heard).not.toHaveBeenCalled();
    expect(await testPrisma.message.count({ where: { workspaceId } })).toBe(0);
  });

  it("sends every open view the updated items when one is changed", async () => {
    const item = await testPrisma.actionItem.create({
      data: { workspaceId, meetingId, text: "Ship it" },
    });
    const listener = await joined(owner);
    const heard = waitForEvent<ActionItemsEvent>(
      listener,
      "meeting:action-items",
    );

    const res = await api(member)
      .patch(`/api/action-items/${item.id}`)
      .send({ status: "DONE" });

    expect(res.status).toBe(200);
    const event = await heard;
    expect(event.meetingId).toBe(meetingId);
    expect(event.items).toEqual([
      expect.objectContaining({ id: item.id, status: "DONE" }),
    ]);
  });

  it("tells every open view when a meeting is deleted", async () => {
    const listener = await joined(owner);
    const deleted = waitForEvent<{ meetingId: string }>(
      listener,
      "meeting:deleted",
    );

    const res = await api(owner).delete(`/api/meetings/${meetingId}`);

    expect(res.status).toBe(200);
    expect(await deleted).toEqual({ meetingId });
    expect(await testPrisma.meeting.count({ where: { id: meetingId } })).toBe(
      0,
    );
  });

  it("announces a deleted action item's id", async () => {
    const item = await testPrisma.actionItem.create({
      data: { workspaceId, meetingId, text: "Drop me" },
    });
    const listener = await joined(owner);
    const heard = waitForEvent<ActionItemsEvent>(
      listener,
      "meeting:action-items",
    );

    const res = await api(owner).delete(`/api/action-items/${item.id}`);

    expect(res.status).toBe(200);
    expect(await heard).toEqual({
      meetingId,
      items: [],
      removedIds: [item.id],
    });
  });
});
