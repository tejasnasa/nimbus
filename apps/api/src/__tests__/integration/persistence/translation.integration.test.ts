/**
 * @module api/__tests__/integration/persistence/translation
 * @description Stored translations coming back out of `GET /segments?language=`:
 * the right language only, null where a segment has none, no translation field
 * when no language is asked for, a 400 for an unsupported language, and members
 * only. Also that deleting a meeting takes its translations with it.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app";
import {
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

afterAll(closeTestResources);

describe("persistence: segment translations", () => {
  let owner: TestUser;
  let outsider: TestUser;
  let meetingId: string;
  let segmentIds: string[];

  beforeEach(async () => {
    await resetDatabase();
    owner = await mintUser(app, { name: "Olive Owner" });
    outsider = await mintUser(app, { name: "Otto Outsider" });
    const workspaceId = (await createWorkspace(owner.id)).id;
    meetingId = (await createMeeting(workspaceId, { startedById: owner.id }))
      .id;
    segmentIds = [];
    for (const seq of [1, 2, 3]) {
      const row = await testPrisma.transcriptSegment.create({
        data: {
          meetingId,
          seq,
          speakerName: "Olive",
          text: `line ${seq}`,
          startMs: seq * 1000,
          endMs: seq * 1000 + 500,
          language: "en",
        },
      });
      segmentIds.push(row.id);
    }
    await testPrisma.segmentTranslation.createMany({
      data: [
        { segmentId: segmentIds[0]!, language: "hi", text: "पंक्ति 1" },
        { segmentId: segmentIds[0]!, language: "es", text: "línea 1" },
        { segmentId: segmentIds[2]!, language: "hi", text: "पंक्ति 3" },
      ],
    });
  });

  const get = (user: TestUser, query: string) =>
    as(app, user).get(`/api/meetings/${meetingId}/segments${query}`);

  it("returns the stored translation for the requested language, null where there is none", async () => {
    const res = await get(owner, "?language=hi");

    expect(res.status).toBe(200);
    expect(
      res.body.responseObject.segments.map(
        (s: { seq: number; translation: string | null }) => [
          s.seq,
          s.translation,
        ],
      ),
    ).toEqual([
      [1, "पंक्ति 1"],
      [2, null],
      [3, "पंक्ति 3"],
    ]);
  });

  it("returns a different language's text for the same segment", async () => {
    const res = await get(owner, "?language=es&afterSeq=0&limit=1");

    expect(res.body.responseObject.segments).toMatchObject([
      { seq: 1, text: "line 1", translation: "línea 1" },
    ]);
    expect(res.body.responseObject.hasMore).toBe(true);
  });

  it("adds no translation field when no language is requested", async () => {
    const res = await get(owner, "");

    expect(res.status).toBe(200);
    for (const segment of res.body.responseObject.segments) {
      expect(segment).not.toHaveProperty("translation");
    }
  });

  it("rejects an unsupported language", async () => {
    expect((await get(owner, "?language=xx")).status).toBe(400);
  });

  it("answers 404 to a non-member, translations included", async () => {
    const res = await get(outsider, "?language=hi");
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("पंक्ति");
  });

  it("deletes translations with their segment", async () => {
    await testPrisma.meeting.delete({ where: { id: meetingId } });
    expect(await testPrisma.segmentTranslation.count()).toBe(0);
  });
});
