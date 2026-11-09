import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  acquireDatabaseLock,
  capturePrismaError,
  createTestClient,
  createUser,
  createWorkspace,
  releaseDatabaseLock,
  truncateAll,
} from "./dbTestUtils";

/**
 * What the database itself guarantees about meetings and their transcripts:
 * one live meeting per workspace, one segment per (meeting, sequence number),
 * and what is kept or removed when a workspace, meeting or speaker goes.
 *
 * The one-live-meeting rule is a partial unique index added by hand in the
 * migration (Prisma cannot express it), so only a real server proves it.
 */
let client: PrismaClient;

beforeAll(async () => {
  await acquireDatabaseLock();
  client = createTestClient();
}, 120_000);

beforeEach(async () => {
  await truncateAll(client);
});

afterAll(async () => {
  await client.$disconnect();
  await releaseDatabaseLock();
});

const meetingFor = (
  workspaceId: string,
  extra: Partial<{ status: "LIVE" | "ENDED"; startedById: string }> = {},
) =>
  client.meeting.create({
    data: {
      workspaceId,
      roomName: `nimbus-ws-${workspaceId}`,
      source: "BYOK",
      ...extra,
    },
  });

const lineFor = (
  meetingId: string,
  seq: number,
  speakerUserId: string | null = null,
) =>
  client.transcriptSegment.create({
    data: {
      meetingId,
      seq,
      speakerUserId,
      speakerName: "Ada",
      text: `line ${seq}`,
      startMs: seq * 1000,
      endMs: seq * 1000 + 500,
    },
  });

describe("one live meeting per workspace", () => {
  it("defaults a new meeting to live with no segments stored", async () => {
    const workspace = await createWorkspace(client);

    const meeting = await meetingFor(workspace.id);

    expect(meeting.status).toBe("LIVE");
    expect(meeting.lastSeq).toBe(0);
    expect(meeting.endedAt).toBeNull();
  });

  it("refuses a second live meeting in the same workspace", async () => {
    const workspace = await createWorkspace(client);
    await meetingFor(workspace.id);

    await capturePrismaError(() => meetingFor(workspace.id), "P2002");
  });

  it("allows a new live meeting once the earlier one has ended", async () => {
    const workspace = await createWorkspace(client);
    const first = await meetingFor(workspace.id);
    await client.meeting.update({
      where: { id: first.id },
      data: { status: "ENDED", endedAt: new Date() },
    });

    const second = await meetingFor(workspace.id);

    expect(second.status).toBe("LIVE");
  });

  it("allows any number of ended meetings, and a live one in another workspace", async () => {
    const one = await createWorkspace(client);
    const two = await createWorkspace(client);
    await meetingFor(one.id, { status: "ENDED" });
    await meetingFor(one.id, { status: "ENDED" });
    await meetingFor(one.id);

    await expect(meetingFor(two.id)).resolves.toMatchObject({ status: "LIVE" });
  });
});

describe("transcript segments", () => {
  it("keeps one segment per sequence number in a meeting", async () => {
    const workspace = await createWorkspace(client);
    const meeting = await meetingFor(workspace.id);
    await lineFor(meeting.id, 1);

    await capturePrismaError(() => lineFor(meeting.id, 1), "P2002");
    await expect(lineFor(meeting.id, 2)).resolves.toMatchObject({ seq: 2 });
  });

  it("lets two meetings use the same sequence numbers", async () => {
    const workspace = await createWorkspace(client);
    const earlier = await meetingFor(workspace.id, { status: "ENDED" });
    const later = await meetingFor(workspace.id);

    await lineFor(earlier.id, 1);

    await expect(lineFor(later.id, 1)).resolves.toMatchObject({ seq: 1 });
  });

  it("replays a batch without duplicating what was stored", async () => {
    const workspace = await createWorkspace(client);
    const meeting = await meetingFor(workspace.id);
    const row = (seq: number) => ({
      meetingId: meeting.id,
      seq,
      speakerName: "Ada",
      text: `line ${seq}`,
      startMs: 0,
      endMs: 1,
    });

    const first = await client.transcriptSegment.createManyAndReturn({
      data: [row(1), row(2)],
      skipDuplicates: true,
    });
    const replay = await client.transcriptSegment.createManyAndReturn({
      data: [row(1), row(2), row(3)],
      skipDuplicates: true,
    });

    expect(first).toHaveLength(2);
    expect(replay.map((s) => s.seq)).toEqual([3]);
  });
});

describe("what outlives what", () => {
  it("removes meetings and their segments with the workspace", async () => {
    const workspace = await createWorkspace(client);
    const meeting = await meetingFor(workspace.id);
    await lineFor(meeting.id, 1);

    await client.workspace.delete({ where: { id: workspace.id } });

    expect(await client.meeting.count()).toBe(0);
    expect(await client.transcriptSegment.count()).toBe(0);
  });

  it("removes segments with their meeting", async () => {
    const workspace = await createWorkspace(client);
    const meeting = await meetingFor(workspace.id);
    await lineFor(meeting.id, 1);

    await client.meeting.delete({ where: { id: meeting.id } });

    expect(await client.transcriptSegment.count()).toBe(0);
  });

  it("keeps the meeting and its words when the person who started or spoke them is deleted", async () => {
    const starter = await createUser(client, { name: "Starter" });
    const workspace = await createWorkspace(client);
    const meeting = await meetingFor(workspace.id, { startedById: starter.id });
    await lineFor(meeting.id, 1, starter.id);

    await client.user.delete({ where: { id: starter.id } });

    const kept = await client.meeting.findUniqueOrThrow({
      where: { id: meeting.id },
    });
    const segment = await client.transcriptSegment.findFirstOrThrow({
      where: { meetingId: meeting.id },
    });
    expect(kept.startedById).toBeNull();
    expect(segment.speakerUserId).toBeNull();
    expect(segment.speakerName).toBe("Ada");
  });

  it("links an AI call to its meeting and leaves the call when the meeting goes", async () => {
    const workspace = await createWorkspace(client);
    const meeting = await meetingFor(workspace.id);
    const call = await client.aiCall.create({
      data: {
        workspaceId: workspace.id,
        meetingId: meeting.id,
        feature: "TRANSCRIPTION",
        providerId: "openrouter",
        modelId: "m",
        source: "FREE",
        status: "OK",
        latencyMs: 1,
      },
    });
    expect(call.meetingId).toBe(meeting.id);

    await client.meeting.delete({ where: { id: meeting.id } });

    const kept = await client.aiCall.findUniqueOrThrow({
      where: { id: call.id },
    });
    expect(kept.meetingId).toBeNull();
  });
});
