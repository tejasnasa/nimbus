/**
 * @module api/__tests__/integration/http/meetings.list.http
 * @description The workspace's meeting history over HTTP: members only, newest
 * first, who started each meeting and how many segments it holds, and cursor
 * paging that never crosses into another workspace.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app";
import {
  addMember,
  as,
  closeTestResources,
  createMeeting,
  createWorkspace,
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";

const app = createApp();

afterAll(async () => {
  await closeTestResources();
});

type Listed = {
  id: string;
  startedByName: string | null;
  segmentCount: number;
  status: string;
};

describe("http: meeting history", () => {
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;

  const list = (user: TestUser, query: string) =>
    as(app, user).get(`/api/meetings?${query}`);

  /** Three ended meetings an hour apart, oldest first. */
  const seedMeetings = async () => {
    const base = Date.UTC(2026, 10, 1, 9);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const meeting = await createMeeting(workspaceId, {
        startedById: owner.id,
        status: "ENDED",
        startedAt: new Date(base + i * 3_600_000),
        endedAt: new Date(base + i * 3_600_000 + 600_000),
      });
      ids.push(meeting.id);
    }
    return ids;
  };

  beforeEach(async () => {
    await resetDatabase();
    owner = await mintUser(app, { name: "Olive Owner" });
    member = await mintUser(app, { name: "Mia Member" });
    outsider = await mintUser(app, { name: "Otto Outsider" });
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, member.id, "MEMBER");
  });

  it("lists meetings newest first with their starter and segment count", async () => {
    const [oldest, , newest] = await seedMeetings();
    await testPrisma.transcriptSegment.createMany({
      data: [1, 2].map((seq) => ({
        meetingId: newest!,
        seq,
        speakerUserId: owner.id,
        speakerName: "Olive Owner",
        text: `line ${seq}`,
        startMs: seq * 1000,
        endMs: seq * 1000 + 500,
      })),
    });

    const res = await list(member, `workspaceId=${workspaceId}`);

    expect(res.status).toBe(200);
    const meetings = res.body.responseObject.meetings as Listed[];
    expect(meetings).toHaveLength(3);
    expect(meetings[0]!.id).toBe(newest);
    expect(meetings[2]!.id).toBe(oldest);
    expect(meetings[0]).toMatchObject({
      startedByName: "Olive Owner",
      segmentCount: 2,
      status: "ENDED",
    });
    expect(meetings[1]!.segmentCount).toBe(0);
    expect(res.body.responseObject.nextCursor).toBeNull();
  });

  it("pages with a cursor until the last meeting", async () => {
    const [oldest, middle, newest] = await seedMeetings();

    const first = await list(member, `workspaceId=${workspaceId}&limit=2`);
    const firstIds = (first.body.responseObject.meetings as Listed[]).map(
      (m) => m.id,
    );
    expect(firstIds).toEqual([newest, middle]);
    expect(first.body.responseObject.nextCursor).toBe(middle);

    const second = await list(
      member,
      `workspaceId=${workspaceId}&limit=2&cursor=${middle}`,
    );
    const secondIds = (second.body.responseObject.meetings as Listed[]).map(
      (m) => m.id,
    );
    expect(secondIds).toEqual([oldest]);
    expect(second.body.responseObject.nextCursor).toBeNull();
  });

  it("shows no starter once that user is gone", async () => {
    await createMeeting(workspaceId, { startedById: null, status: "ENDED" });

    const res = await list(owner, `workspaceId=${workspaceId}`);

    expect(res.body.responseObject.meetings[0].startedByName).toBeNull();
  });

  it("answers a non-member with 404", async () => {
    await seedMeetings();

    const res = await list(outsider, `workspaceId=${workspaceId}`);

    expect(res.status).toBe(404);
  });

  it("refuses a cursor from another workspace", async () => {
    const otherWorkspace = (await createWorkspace(outsider.id)).id;
    const foreign = await createMeeting(otherWorkspace, { status: "ENDED" });

    const res = await list(
      member,
      `workspaceId=${workspaceId}&cursor=${foreign.id}`,
    );

    expect(res.status).toBe(400);
  });

  it("rejects a missing workspace id and an oversized page", async () => {
    expect((await list(member, "")).status).toBe(400);
    expect(
      (await list(member, `workspaceId=${workspaceId}&limit=999`)).status,
    ).toBe(400);
  });

  it("requires a signed-in user", async () => {
    const res = await as(app, { cookie: "" } as TestUser).get(
      `/api/meetings?workspaceId=${workspaceId}`,
    );

    expect(res.status).toBe(401);
  });
});
