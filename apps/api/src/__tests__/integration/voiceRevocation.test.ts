/**
 * @module api/__tests__/integration/voiceRevocation
 * @description A person whose access to a workspace ends is taken off its call
 * immediately. Runs against the real LiveKit dev server: a genuine participant
 * connects with a token the API minted, and the test watches the media server
 * drop it.
 *
 * Covers the three paths that end a membership (removal by an admin, workspace
 * deletion, account deletion), the guarantee that revocation never blocks the
 * operation that triggered it, and that "already gone" is not an error.
 */
import { Room as RtcRoom, RoomEvent } from "@livekit/rtc-node";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../../app";
import { cascadeOwnedWorkspaces } from "../../lib/accountDeletion";
import { resetLivekitClients } from "../../lib/livekit/client";
import { removeFromCall } from "../../lib/livekit/revocation";
import { roomNameFor } from "../../lib/livekit/rooms";
import { createParticipantToken } from "../../lib/livekit/tokens";
import {
  addMember,
  as,
  closeTestResources,
  createWorkspace,
  devRoomService,
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";

const app = createApp();
const connected: RtcRoom[] = [];

afterAll(closeTestResources);

/** Connects a real participant to a workspace's room. */
const joinCall = async (user: TestUser, workspaceId: string) => {
  const token = await createParticipantToken({
    user: { id: user.id, name: user.name },
    workspaceId,
  });
  const room = new RtcRoom();
  await room.connect(process.env.LIVEKIT_URL!, token, { autoSubscribe: false });
  connected.push(room);
  const disconnected = new Promise<void>((resolve) =>
    room.once(RoomEvent.Disconnected, () => resolve()),
  );
  return { room, disconnected };
};

const identitiesIn = async (workspaceId: string) =>
  (await devRoomService().listParticipants(roomNameFor(workspaceId)))
    .map((p) => p.identity)
    .sort();

/** Waits until the media server reports `identity` absent (or the room gone). */
const waitUntilAbsent = async (workspaceId: string, identity: string) => {
  await vi.waitFor(
    async () => {
      const present = await identitiesIn(workspaceId).catch(() => []);
      expect(present).not.toContain(identity);
    },
    { timeout: 8_000, interval: 200 },
  );
};

const raceTimeout = <T>(promise: Promise<T>, ms = 8_000) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), ms),
    ),
  ]);

describe("voice revocation (against the LiveKit dev server)", () => {
  let owner: TestUser;
  let member: TestUser;
  let workspaceId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await mintUser(app, { name: "Olive Owner" });
    member = await mintUser(app, { name: "Mia Member" });
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, member.id, "MEMBER");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env.LIVEKIT_URL = "ws://localhost:7880";
    resetLivekitClients();
    for (const room of connected.splice(0)) await room.disconnect();
  });

  it("puts a joined participant in the workspace's room", async () => {
    await joinCall(member, workspaceId);

    await expect(identitiesIn(workspaceId)).resolves.toEqual([member.id]);
  });

  it("disconnects a member when an admin removes them", async () => {
    const { disconnected } = await joinCall(member, workspaceId);
    await joinCall(owner, workspaceId);

    const res = await as(app, owner)
      .delete(`/api/workspace/leave/${workspaceId}`)
      .send({ memberId: member.id });
    expect(res.status).toBe(200);

    await raceTimeout(disconnected);
    await waitUntilAbsent(workspaceId, member.id);
    // Only the removed member goes; everyone else stays on the call.
    await expect(identitiesIn(workspaceId)).resolves.toEqual([owner.id]);
  });

  it("refuses the removed member a fresh token", async () => {
    await as(app, owner)
      .delete(`/api/workspace/leave/${workspaceId}`)
      .send({ memberId: member.id })
      .expect(200);

    const res = await as(app, member)
      .post("/api/voice/token")
      .send({ workspaceId });

    expect(res.status).toBe(404);
  });

  it("disconnects everyone when the workspace is deleted", async () => {
    const a = await joinCall(owner, workspaceId);
    const b = await joinCall(member, workspaceId);

    const res = await as(app, owner).delete(
      `/api/workspace/delete/${workspaceId}`,
    );
    expect(res.status).toBe(200);

    await raceTimeout(Promise.all([a.disconnected, b.disconnected]));
  });

  it("takes a deleted account off every call it was on", async () => {
    const otherWorkspace = (await createWorkspace(owner.id, "Other")).id;
    await addMember(otherWorkspace, member.id, "MEMBER");
    const here = await joinCall(member, workspaceId);
    const there = await joinCall(member, otherWorkspace);

    // `cascadeOwnedWorkspaces` is the account-deletion hook's policy. The member
    // owns neither workspace, so only their own participants should go.
    await cascadeOwnedWorkspaces({ id: member.id });

    await raceTimeout(Promise.all([here.disconnected, there.disconnected]));
  });

  it("ends the calls of other members when the owner's account is deleted", async () => {
    const guest = await joinCall(member, workspaceId);
    const host = await joinCall(owner, workspaceId);

    const { deletedCount } = await cascadeOwnedWorkspaces({ id: owner.id });

    expect(deletedCount).toBe(1);
    await raceTimeout(Promise.all([guest.disconnected, host.disconnected]));
  });

  it("treats a room or participant that is already gone as success, silently", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      removeFromCall("no-such-workspace", "no-such-user"),
    ).resolves.toBeUndefined();
    await expect(removeFromCall(workspaceId, member.id)).resolves.toBeUndefined();

    expect(errorLog).not.toHaveBeenCalled();
  });

  it("logs and carries on when the media server is unreachable", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.LIVEKIT_URL = "ws://127.0.0.1:1";
    resetLivekitClients();

    await expect(removeFromCall(workspaceId, member.id)).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("could not remove"),
      expect.anything(),
    );
  });

  it("still removes the member when the media server is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.LIVEKIT_URL = "ws://127.0.0.1:1";
    resetLivekitClients();

    const res = await as(app, owner)
      .delete(`/api/workspace/leave/${workspaceId}`)
      .send({ memberId: member.id });

    expect(res.status).toBe(200);
    await expect(
      testPrisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: { userId: member.id, workspaceId },
        },
      }),
    ).resolves.toBeNull();
  });

  it("still deletes the workspace when the media server is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.LIVEKIT_URL = "ws://127.0.0.1:1";
    resetLivekitClients();

    const res = await as(app, owner).delete(
      `/api/workspace/delete/${workspaceId}`,
    );

    expect(res.status).toBe(200);
    await expect(
      testPrisma.workspace.findUnique({ where: { id: workspaceId } }),
    ).resolves.toBeNull();
  });
});
