/**
 * @module api/__tests__/security/meetings.security
 * @description Workspace isolation for meetings and action items: a member of
 * one workspace can read, search, draw, delete or change nothing that belongs
 * to another, and cannot tell from the answer whether it exists. Every route
 * also needs a session.
 */
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import {
  as,
  closeTestResources,
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

describe("security: meetings and action items across workspaces", () => {
  let victim: TestUser;
  let attacker: TestUser;
  let victimWorkspace: string;
  let attackerWorkspace: string;
  let meetingId: string;
  let itemId: string;

  beforeEach(async () => {
    await resetDatabase();
    broadcasts.emitted.length = 0;
    victim = await mintUser(app, { name: "Vera Victim" });
    attacker = await mintUser(app, { name: "Adam Attacker" });
    victimWorkspace = (await createWorkspace(victim.id)).id;
    attackerWorkspace = (await createWorkspace(attacker.id)).id;
    meetingId = (
      await createMeeting(victimWorkspace, {
        startedById: victim.id,
        status: "SUMMARIZED",
      })
    ).id;
    await testPrisma.meeting.update({
      where: { id: meetingId },
      data: { title: "Confidential", summary: sampleNotes() as object },
    });
    await seedTranscript(meetingId, SAMPLE_LINES);
    itemId = (
      await testPrisma.actionItem.create({
        data: {
          workspaceId: victimWorkspace,
          meetingId,
          text: "Secret task",
          ownerUserId: victim.id,
        },
      })
    ).id;
  });

  const stillIntact = async () => {
    expect(await testPrisma.meeting.count({ where: { id: meetingId } })).toBe(
      1,
    );
    expect(
      await testPrisma.transcriptSegment.count({ where: { meetingId } }),
    ).toBe(4);
    const item = await testPrisma.actionItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(item).toMatchObject({
      text: "Secret task",
      status: "OPEN",
      ownerUserId: victim.id,
      meetingId,
    });
    expect(broadcasts.emitted).toEqual([]);
  };

  describe("meetings", () => {
    it.each([
      ["the detail", (id: string) => `/api/meetings/${id}`],
      ["the transcript", (id: string) => `/api/meetings/${id}/segments`],
      ["catch me up", (id: string) => `/api/meetings/${id}/catch-up`],
    ])(
      "answers 404 to %s of another workspace's meeting",
      async (_label, path) => {
        const foreign = await as(app, attacker).get(path(meetingId));
        const missing = await as(app, attacker).get(path("does-not-exist"));

        expect(foreign.status).toBe(404);
        expect(foreign.body).toEqual(missing.body);
        expect(JSON.stringify(foreign.body)).not.toContain("Confidential");
      },
    );

    it("answers 404 to drawing another workspace's meeting", async () => {
      const res = await as(app, attacker).post(
        `/api/meetings/${meetingId}/diagram`,
      );
      expect(res.status).toBe(404);
      expect(broadcasts.emitted).toEqual([]);
    });

    it("answers 404 to deleting another workspace's meeting, and deletes nothing", async () => {
      const res = await as(app, attacker).delete(`/api/meetings/${meetingId}`);
      expect(res.status).toBe(404);
      await stillIntact();
    });

    it("answers 404 to searching another workspace and finds nothing in your own", async () => {
      const foreign = await as(app, attacker).get(
        `/api/meetings/search?workspaceId=${victimWorkspace}&q=changelog`,
      );
      expect(foreign.status).toBe(404);

      const own = await as(app, attacker).get(
        `/api/meetings/search?workspaceId=${attackerWorkspace}&q=changelog`,
      );
      expect(own.status).toBe(200);
      expect(own.body.responseObject.hits).toEqual([]);
    });

    it("does not list another workspace's meetings", async () => {
      const res = await as(app, attacker).get(
        `/api/meetings?workspaceId=${victimWorkspace}`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("action items", () => {
    it("answers 404 to changing another workspace's item, and changes nothing", async () => {
      for (const body of [
        { status: "DONE" },
        { text: "hijacked" },
        { dueDate: "2026-12-01" },
        { ownerUserId: attacker.id },
        { ownerUserId: null },
      ]) {
        const res = await as(app, attacker)
          .patch(`/api/action-items/${itemId}`)
          .send(body);
        expect(res.status).toBe(404);
      }
      await stillIntact();
    });

    it("answers 404 to deleting another workspace's item, and deletes nothing", async () => {
      const res = await as(app, attacker).delete(`/api/action-items/${itemId}`);
      expect(res.status).toBe(404);
      await stillIntact();
    });

    it("answers a foreign item exactly as it answers a missing one", async () => {
      const foreign = await as(app, attacker)
        .patch(`/api/action-items/${itemId}`)
        .send({ status: "DONE" });
      const missing = await as(app, attacker)
        .patch("/api/action-items/does-not-exist")
        .send({ status: "DONE" });
      expect(foreign.status).toBe(missing.status);
      expect(foreign.body).toEqual(missing.body);
    });

    it("answers 404 to listing another workspace's items", async () => {
      const res = await as(app, attacker).get(
        `/api/action-items?workspaceId=${victimWorkspace}&status=all`,
      );
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("Secret task");
    });

    it("refuses to page your own list with a cursor from another workspace", async () => {
      const res = await as(app, attacker).get(
        `/api/action-items?workspaceId=${attackerWorkspace}&cursor=${itemId}`,
      );
      expect(res.status).toBe(400);
    });

    it("refuses to make someone from another workspace an owner", async () => {
      const own = await testPrisma.actionItem.create({
        data: { workspaceId: attackerWorkspace, text: "Mine" },
      });

      const res = await as(app, attacker)
        .patch(`/api/action-items/${own.id}`)
        .send({ ownerUserId: victim.id });

      expect(res.status).toBe(400);
      expect(
        (
          await testPrisma.actionItem.findUniqueOrThrow({
            where: { id: own.id },
          })
        ).ownerUserId,
      ).toBeNull();
    });
  });

  describe("authentication", () => {
    it.each([
      ["get", "/api/meetings/ID"],
      ["get", "/api/meetings/ID/catch-up"],
      ["get", "/api/meetings/search?workspaceId=W&q=x"],
      ["post", "/api/meetings/ID/diagram"],
      ["delete", "/api/meetings/ID"],
      ["get", "/api/action-items?workspaceId=W"],
      ["patch", "/api/action-items/ID"],
      ["delete", "/api/action-items/ID"],
    ] as const)("%s %s needs a session", async (method, path) => {
      const res = await request(app)[method](
        path.replace("ID", itemId).replace("W", victimWorkspace),
      );
      expect(res.status).toBe(401);
    });
  });
});
