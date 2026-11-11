/**
 * @module api/__tests__/integration/http/meetings.http
 * @description The meeting endpoints added for notes: the detail with its
 * summary, decisions, action items and participants; the list's new fields;
 * "catch me up"; keyword search and its route ordering; and deleting a meeting
 * (who may, live meetings refused, what cascades and what is kept, and the
 * broadcast).
 */
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app";
import {
  addMember,
  as,
  closeTestResources,
  createDocument,
  createMeeting,
  createWorkspace,
  fakeIo,
  mintUser,
  resetDatabase,
  sampleNotes,
  seedTranscript,
  SAMPLE_LINES,
  testPrisma,
  type TestUser,
} from "@testhelpers";

const app = createApp();
const broadcasts = fakeIo();
app.set("io", broadcasts.io);

afterAll(closeTestResources);

describe("http: meetings", () => {
  let owner: TestUser;
  let admin: TestUser;
  let starter: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let meetingId: string;
  let notesDocumentId: string;

  /** An ended, summarised meeting started by `starter`, with its notes stored. */
  const seedFinishedMeeting = async () => {
    const meeting = await createMeeting(workspaceId, {
      startedById: starter.id,
      status: "SUMMARIZED",
      startedAt: new Date("2026-11-09T09:00:00Z"),
      endedAt: new Date("2026-11-09T09:30:00Z"),
    });
    const segmentIds = await seedTranscript(meeting.id, [
      ...SAMPLE_LINES.slice(0, 2).map((line, index) => ({
        ...line,
        speakerUserId: index === 0 ? starter.id : null,
      })),
      ...SAMPLE_LINES.slice(2),
    ]);
    const notes = await createDocument(workspaceId, {
      title: "Meeting notes",
      type: "MARKDOWN",
    });
    await testPrisma.meeting.update({
      where: { id: meeting.id },
      data: {
        title: "Beta launch planning",
        summary: sampleNotes() as object,
        notesDocumentId: notes.id,
      },
    });
    await testPrisma.decision.create({
      data: {
        workspaceId,
        meetingId: meeting.id,
        text: "Ship the beta on Friday",
        sourceSegmentId: segmentIds[0],
      },
    });
    await testPrisma.actionItem.createMany({
      data: [
        {
          workspaceId,
          meetingId: meeting.id,
          text: "Update the changelog",
          ownerUserId: member.id,
          ownerName: "Mia",
          dueDate: new Date("2026-11-13T00:00:00Z"),
          sourceSegmentId: segmentIds[1],
        },
        { workspaceId, meetingId: meeting.id, text: "Write the plan" },
      ],
    });
    await testPrisma.segmentTranslation.create({
      data: { segmentId: segmentIds[0]!, language: "hi", text: "नमस्ते" },
    });
    return { meetingId: meeting.id, notesDocumentId: notes.id };
  };

  beforeEach(async () => {
    await resetDatabase();
    broadcasts.emitted.length = 0;
    owner = await mintUser(app, { name: "Olive Owner" });
    admin = await mintUser(app, { name: "Adam Admin" });
    starter = await mintUser(app, { name: "Priya Starter" });
    member = await mintUser(app, { name: "Mia Member" });
    outsider = await mintUser(app, { name: "Otto Outsider" });
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, admin.id, "ADMIN");
    await addMember(workspaceId, starter.id, "MEMBER");
    await addMember(workspaceId, member.id, "MEMBER");
    ({ meetingId, notesDocumentId } = await seedFinishedMeeting());
  });

  describe("GET /api/meetings/:meetingId", () => {
    it("returns the notes, decisions, action items and participants", async () => {
      const res = await as(app, member).get(`/api/meetings/${meetingId}`);

      expect(res.status).toBe(200);
      const detail = res.body.responseObject;
      expect(detail).toMatchObject({
        id: meetingId,
        workspaceId,
        status: "SUMMARIZED",
        title: "Beta launch planning",
        startedByName: "Priya Starter",
        segmentCount: 4,
        notesDocumentId,
        failureReason: null,
        startedAt: "2026-11-09T09:00:00.000Z",
        endedAt: "2026-11-09T09:30:00.000Z",
      });
      expect(detail.summary).toMatchObject({
        title: "Beta launch planning",
        topics: ["beta launch", "rollback"],
      });
      expect(detail.decisions).toEqual([
        expect.objectContaining({
          text: "Ship the beta on Friday",
          sourceSeq: 1,
          meetingId,
        }),
      ]);
      expect(detail.actionItems).toHaveLength(2);
      expect(detail.actionItems[0]).toMatchObject({
        text: "Update the changelog",
        ownerUserId: member.id,
        ownerName: "Mia Member",
        dueDate: "2026-11-13",
        status: "OPEN",
        sourceSeq: 2,
        meetingId,
        meetingTitle: "Beta launch planning",
        completedAt: null,
      });
      expect(detail.actionItems[1]).toMatchObject({
        text: "Write the plan",
        ownerUserId: null,
        ownerName: null,
        dueDate: null,
      });
      expect(detail.participants).toEqual([
        { userId: starter.id, name: "Priya Shah" },
        { userId: null, name: "Tom Brandt" },
      ]);
    });

    it("has no summary for a meeting without notes", async () => {
      const bare = await createMeeting(workspaceId, {
        startedById: starter.id,
        status: "ENDED",
      });

      const res = await as(app, starter).get(`/api/meetings/${bare.id}`);

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toMatchObject({
        summary: null,
        decisions: [],
        actionItems: [],
        participants: [],
        notesDocumentId: null,
        title: null,
      });
    });

    it("shows why the notes failed", async () => {
      const failed = await createMeeting(workspaceId, {
        startedById: starter.id,
        status: "FAILED",
      });
      await testPrisma.meeting.update({
        where: { id: failed.id },
        data: { failureReason: "invalid-summary: title: too long" },
      });

      const res = await as(app, starter).get(`/api/meetings/${failed.id}`);

      expect(res.body.responseObject.failureReason).toBe(
        "invalid-summary: title: too long",
      );
    });

    it("answers 404 to a non-member, a missing meeting and requires a session", async () => {
      expect(
        (await as(app, outsider).get(`/api/meetings/${meetingId}`)).status,
      ).toBe(404);
      expect((await as(app, member).get("/api/meetings/missing")).status).toBe(
        404,
      );
      expect(
        (await request(app).get(`/api/meetings/${meetingId}`)).status,
      ).toBe(401);
    });
  });

  describe("route ordering", () => {
    it("serves /search and /live rather than reading them as meeting ids", async () => {
      const search = await as(app, member).get(
        `/api/meetings/search?workspaceId=${workspaceId}&q=beta`,
      );
      expect(search.status).toBe(200);
      expect(search.body.responseObject.hits).toBeDefined();

      const live = await as(app, member).get(
        `/api/meetings/live?workspaceId=${workspaceId}`,
      );
      expect(live.status).toBe(200);
      expect(live.body.responseObject).toEqual({ meeting: null });
    });
  });

  describe("GET /api/meetings", () => {
    it("adds the title and notes document to each row", async () => {
      const res = await as(app, member).get(
        `/api/meetings?workspaceId=${workspaceId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.responseObject.meetings[0]).toMatchObject({
        id: meetingId,
        title: "Beta launch planning",
        status: "SUMMARIZED",
        notesDocumentId,
        segmentCount: 4,
      });
    });
  });

  describe("GET /api/meetings/search", () => {
    it("returns highlighted hits for members", async () => {
      const res = await as(app, member).get(
        `/api/meetings/search?workspaceId=${workspaceId}&q=changelog&limit=5`,
      );

      expect(res.status).toBe(200);
      const [hit] = res.body.responseObject.hits;
      expect(hit).toMatchObject({
        meetingId,
        meetingTitle: "Beta launch planning",
        speakerName: "Tom Brandt",
        seq: 2,
      });
      expect(hit.snippet).toContain("<mark>changelog</mark>");
    });

    it("honours sinceDays", async () => {
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: { startedAt: new Date(Date.now() - 40 * 86_400_000) },
      });
      const res = await as(app, member).get(
        `/api/meetings/search?workspaceId=${workspaceId}&q=changelog&sinceDays=1`,
      );
      expect(res.body.responseObject.hits).toEqual([]);
    });

    it("validates the query and hides the workspace from non-members", async () => {
      expect(
        (
          await as(app, member).get(
            `/api/meetings/search?workspaceId=${workspaceId}`,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await as(app, member).get(
            `/api/meetings/search?workspaceId=${workspaceId}&q=x&limit=500`,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await as(app, outsider).get(
            `/api/meetings/search?workspaceId=${workspaceId}&q=beta`,
          )
        ).status,
      ).toBe(404);
    });
  });

  describe("GET /api/meetings/:meetingId/catch-up", () => {
    it("returns the stored summary without regenerating a fresh one", async () => {
      const live = await createMeeting(workspaceId, {
        startedById: starter.id,
        startedAt: new Date(Date.now() - 7 * 60_000),
      });
      await seedTranscript(live.id, SAMPLE_LINES);
      await testPrisma.meeting.update({
        where: { id: live.id },
        data: {
          rollingSummary: "- shipping Friday",
          rollingSummarySeq: 2,
          rollingSummaryAt: new Date(),
        },
      });

      const res = await as(app, member).get(
        `/api/meetings/${live.id}/catch-up`,
      );

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toMatchObject({
        summary: "- shipping Friday",
        upToSeq: 2,
        minutesElapsed: 7,
      });
      expect(typeof res.body.responseObject.generatedAt).toBe("string");
    });

    it("answers 404 to a non-member or a missing meeting", async () => {
      expect(
        (await as(app, outsider).get(`/api/meetings/${meetingId}/catch-up`))
          .status,
      ).toBe(404);
      expect(
        (await as(app, member).get("/api/meetings/missing/catch-up")).status,
      ).toBe(404);
    });
  });

  describe("DELETE /api/meetings/:meetingId", () => {
    const itemsOf = () =>
      testPrisma.actionItem.findMany({ orderBy: { createdAt: "asc" } });

    it("lets the member who started it delete it", async () => {
      const res = await as(app, starter).delete(`/api/meetings/${meetingId}`);

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toEqual({ meetingId });
      expect(await testPrisma.meeting.count({ where: { id: meetingId } })).toBe(
        0,
      );
    });

    it("lets an admin and the owner delete a meeting someone else started", async () => {
      expect(
        (await as(app, admin).delete(`/api/meetings/${meetingId}`)).status,
      ).toBe(200);

      const second = await seedFinishedMeeting();
      expect(
        (await as(app, owner).delete(`/api/meetings/${second.meetingId}`))
          .status,
      ).toBe(200);
    });

    it("refuses any other member with 403 and deletes nothing", async () => {
      const res = await as(app, member).delete(`/api/meetings/${meetingId}`);

      expect(res.status).toBe(403);
      expect(await testPrisma.meeting.count({ where: { id: meetingId } })).toBe(
        1,
      );
      expect(broadcasts.emitted).toEqual([]);
    });

    it("answers 404 to a non-member, a missing meeting, and 401 without a session", async () => {
      expect(
        (await as(app, outsider).delete(`/api/meetings/${meetingId}`)).status,
      ).toBe(404);
      expect(
        (await as(app, owner).delete("/api/meetings/missing")).status,
      ).toBe(404);
      expect(
        (await request(app).delete(`/api/meetings/${meetingId}`)).status,
      ).toBe(401);
      expect(await testPrisma.meeting.count({ where: { id: meetingId } })).toBe(
        1,
      );
    });

    it("refuses a live meeting with 409, even for the owner", async () => {
      const live = await createMeeting(workspaceId, {
        startedById: starter.id,
        status: "LIVE",
      });

      const res = await as(app, owner).delete(`/api/meetings/${live.id}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/end the meeting/i);
      expect(await testPrisma.meeting.count({ where: { id: live.id } })).toBe(
        1,
      );
    });

    it("removes the transcript, translations and decisions but keeps action items and the notes document", async () => {
      expect(await testPrisma.segmentTranslation.count()).toBe(1);

      const res = await as(app, starter).delete(`/api/meetings/${meetingId}`);

      expect(res.status).toBe(200);
      expect(await testPrisma.transcriptSegment.count()).toBe(0);
      expect(await testPrisma.segmentTranslation.count()).toBe(0);
      expect(await testPrisma.decision.count()).toBe(0);
      const items = await itemsOf();
      expect(items).toHaveLength(2);
      expect(items.every((item) => item.meetingId === null)).toBe(true);
      expect(
        (
          await testPrisma.document.findUnique({
            where: { id: notesDocumentId },
          })
        )?.title,
      ).toBe("Meeting notes");
    });

    it("tells the workspace the meeting is gone and what became of its items", async () => {
      await as(app, starter).delete(`/api/meetings/${meetingId}`);

      const deleted = broadcasts.emitted.find(
        (e) => e.event === "meeting:deleted",
      );
      expect(deleted).toEqual({
        room: workspaceId,
        event: "meeting:deleted",
        payload: { meetingId },
      });
      const items = broadcasts.emitted.find(
        (e) => e.event === "meeting:action-items",
      );
      expect(items?.room).toBe(workspaceId);
      const payload = items!.payload as {
        meetingId: string | null;
        items: Array<{ meetingId: string | null; meetingTitle: string | null }>;
        removedIds: string[];
      };
      expect(payload.meetingId).toBeNull();
      expect(payload.items).toHaveLength(2);
      expect(
        payload.items.every(
          (i) => i.meetingId === null && i.meetingTitle === null,
        ),
      ).toBe(true);
      expect(payload.removedIds).toEqual([]);
    });

    it("lets in-flight notes and summaries for the deleted meeting end quietly", async () => {
      const { writeNotes } = await import("../../../lib/meeting/notes");
      const { maybeRoll, getCatchUp } =
        await import("../../../lib/meeting/rollingSummary");
      await as(app, starter).delete(`/api/meetings/${meetingId}`);

      expect(await writeNotes(meetingId)).toBe("ignored");
      expect(await maybeRoll(meetingId)).toBe("ignored");
      expect(await getCatchUp(meetingId)).toBeNull();
    });
  });
});
