/**
 * @module api/__tests__/integration/persistence/searchSegments
 * @description Transcript keyword search against the generated tsvector column:
 * matches across the workspace's meetings and no other workspace's, highlighted
 * snippets, the since filter, web-search syntax, and hostile input treated as
 * plain text.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchSegments } from "../../../lib/meeting/search";
import {
  closeTestResources,
  createMeeting,
  createUser,
  createWorkspace,
  resetDatabase,
  seedTranscript,
  testPrisma,
} from "@testhelpers";

afterAll(closeTestResources);

describe("persistence: searchSegments", () => {
  let workspaceId: string;
  let otherWorkspaceId: string;
  let recentId: string;
  let oldId: string;
  const now = new Date("2026-11-10T12:00:00Z").getTime();

  beforeEach(async () => {
    await resetDatabase();
    const owner = await createUser("Olive Owner");
    const other = await createUser("Otto Other");
    workspaceId = (await createWorkspace(owner.id)).id;
    otherWorkspaceId = (await createWorkspace(other.id)).id;

    recentId = (
      await createMeeting(workspaceId, {
        startedById: owner.id,
        status: "SUMMARIZED",
        startedAt: new Date("2026-11-08T10:00:00Z"),
      })
    ).id;
    oldId = (
      await createMeeting(workspaceId, {
        startedById: owner.id,
        status: "SUMMARIZED",
        startedAt: new Date("2026-08-01T10:00:00Z"),
      })
    ).id;
    const foreignId = (
      await createMeeting(otherWorkspaceId, {
        startedById: other.id,
        status: "SUMMARIZED",
        startedAt: new Date("2026-11-08T10:00:00Z"),
      })
    ).id;
    await testPrisma.meeting.update({
      where: { id: recentId },
      data: { title: "Launch review" },
    });

    await seedTranscript(recentId, [
      { speakerName: "Priya", text: "The pricing page needs a rewrite." },
      { speakerName: "Tom", text: "We should ship the migration on Friday." },
      { speakerName: "Priya", text: "Nothing else about it today." },
    ]);
    await seedTranscript(oldId, [
      { speakerName: "Tom", text: "Pricing was discussed back in August." },
    ]);
    await seedTranscript(foreignId, [
      { speakerName: "Otto", text: "Our secret pricing strategy." },
    ]);
  });

  it("finds matches across the workspace's meetings, newest meeting first among equals", async () => {
    const hits = await searchSegments(workspaceId, "pricing");

    expect(hits).toHaveLength(2);
    expect(hits.map((hit) => hit.meetingId)).toEqual([recentId, oldId]);
    expect(hits[0]).toMatchObject({
      meetingTitle: "Launch review",
      speakerName: "Priya",
      seq: 1,
      startMs: 0,
      meetingStartedAt: "2026-11-08T10:00:00.000Z",
    });
    expect(hits[1]!.meetingTitle).toBeNull();
  });

  it("never returns another workspace's transcript", async () => {
    const hits = await searchSegments(workspaceId, "secret");
    expect(hits).toEqual([]);

    const foreign = await searchSegments(otherWorkspaceId, "secret");
    expect(foreign).toHaveLength(1);
    expect(foreign[0]!.speakerName).toBe("Otto");
  });

  it("wraps the matched words in mark tags", async () => {
    const [hit] = await searchSegments(workspaceId, "migration");
    expect(hit!.snippet).toContain("<mark>migration</mark>");
    expect(hit!.snippet).toContain("ship the");
  });

  it("limits to meetings that started within sinceDays", async () => {
    const hits = await searchSegments(workspaceId, "pricing", {
      sinceDays: 30,
      now: () => now,
    });
    expect(hits.map((hit) => hit.meetingId)).toEqual([recentId]);

    const wide = await searchSegments(workspaceId, "pricing", {
      sinceDays: 365,
      now: () => now,
    });
    expect(wide).toHaveLength(2);
  });

  it("honours the limit", async () => {
    expect(
      await searchSegments(workspaceId, "pricing", { limit: 1 }),
    ).toHaveLength(1);
  });

  it("reads web-search syntax: phrases, exclusion and or", async () => {
    expect(await searchSegments(workspaceId, '"pricing page"')).toHaveLength(1);
    expect(await searchSegments(workspaceId, "pricing -august")).toHaveLength(
      1,
    );
    expect(
      await searchSegments(workspaceId, "migration or august"),
    ).toHaveLength(2);
  });

  it("matches without regard to case and punctuation", async () => {
    expect(await searchSegments(workspaceId, "FRIDAY!")).toHaveLength(1);
  });

  it("returns nothing for a query with no usable words", async () => {
    expect(await searchSegments(workspaceId, "!!! ???")).toEqual([]);
  });

  it("treats SQL in the query as ordinary text", async () => {
    const hits = await searchSegments(
      workspaceId,
      '\'; DROP TABLE "Meeting"; --',
    );
    expect(hits).toEqual([]);
    expect(await testPrisma.meeting.count()).toBe(3);
  });

  it("indexes text added later through the generated column", async () => {
    await testPrisma.transcriptSegment.create({
      data: {
        meetingId: recentId,
        seq: 99,
        speakerName: "Tom",
        text: "Zanzibar is the codename.",
        startMs: 1,
        endMs: 2,
      },
    });
    expect(await searchSegments(workspaceId, "zanzibar")).toHaveLength(1);
  });
});
