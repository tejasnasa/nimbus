/**
 * @module api/__tests__/integration/http/actionItems.http
 * @description Action items over HTTP: the filtered, cursor-paged list; what
 * any member may change and what is validated; who may delete; and the
 * `meeting:action-items` broadcast after every change.
 */
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app";
import {
  addMember,
  as,
  closeTestResources,
  createMeeting,
  createWorkspace,
  fakeIo,
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";

const app = createApp();
const broadcasts = fakeIo();
app.set("io", broadcasts.io);

afterAll(closeTestResources);

type Item = {
  id: string;
  text: string;
  status: string;
  ownerUserId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  completedAt: string | null;
  meetingId: string | null;
};

describe("http: action items", () => {
  let owner: TestUser;
  let admin: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let meetingId: string;

  const make = (data: {
    text: string;
    ownerUserId?: string | null;
    ownerName?: string | null;
    dueDate?: string | null;
    status?: "OPEN" | "DONE";
    meetingId?: string | null;
    createdById?: string | null;
    createdAt?: Date;
  }) =>
    testPrisma.actionItem.create({
      data: {
        workspaceId,
        meetingId: data.meetingId === undefined ? meetingId : data.meetingId,
        text: data.text,
        ownerUserId: data.ownerUserId ?? null,
        ownerName: data.ownerName ?? null,
        dueDate: data.dueDate ? new Date(`${data.dueDate}T00:00:00Z`) : null,
        status: data.status ?? "OPEN",
        completedAt: data.status === "DONE" ? new Date() : null,
        createdById: data.createdById ?? null,
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
      },
    });

  const list = (user: TestUser, query: string) =>
    as(app, user).get(`/api/action-items?workspaceId=${workspaceId}${query}`);
  const items = (res: { body: { responseObject: { items: Item[] } } }) =>
    res.body.responseObject.items;
  const lastBroadcast = () =>
    broadcasts.emitted.filter((e) => e.event === "meeting:action-items").at(-1);

  beforeEach(async () => {
    await resetDatabase();
    broadcasts.emitted.length = 0;
    owner = await mintUser(app, { name: "Olive Owner" });
    admin = await mintUser(app, { name: "Adam Admin" });
    alice = await mintUser(app, { name: "Alice Member" });
    bob = await mintUser(app, { name: "Bob Member" });
    outsider = await mintUser(app, { name: "Otto Outsider" });
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, admin.id, "ADMIN");
    await addMember(workspaceId, alice.id, "MEMBER");
    await addMember(workspaceId, bob.id, "MEMBER");
    meetingId = (
      await createMeeting(workspaceId, {
        startedById: alice.id,
        status: "SUMMARIZED",
      })
    ).id;
    await testPrisma.meeting.update({
      where: { id: meetingId },
      data: { title: "Planning" },
    });
  });

  describe("GET /api/action-items", () => {
    it("lists open items by default, soonest due first and undated last", async () => {
      await make({ text: "undated" });
      await make({ text: "later", dueDate: "2026-12-01" });
      await make({ text: "sooner", dueDate: "2026-11-12" });
      await make({ text: "finished", status: "DONE" });

      const res = await list(bob, "");

      expect(res.status).toBe(200);
      expect(items(res).map((i) => i.text)).toEqual([
        "sooner",
        "later",
        "undated",
      ]);
      expect(items(res)[0]).toMatchObject({
        dueDate: "2026-11-12",
        meetingId,
        meetingTitle: "Planning",
      });
      expect(res.body.responseObject.nextCursor).toBeNull();
    });

    it("filters by done and by all", async () => {
      await make({ text: "open one" });
      await make({ text: "done one", status: "DONE" });

      expect(items(await list(bob, "&status=done")).map((i) => i.text)).toEqual(
        ["done one"],
      );
      expect(
        items(await list(bob, "&status=all"))
          .map((i) => i.text)
          .sort(),
      ).toEqual(["done one", "open one"]);
    });

    it("shows only the caller's items with owner=me", async () => {
      await make({ text: "mine", ownerUserId: alice.id });
      await make({ text: "his", ownerUserId: bob.id });
      await make({ text: "nobody" });

      const res = await list(alice, "&owner=me&status=all");

      expect(items(res).map((i) => i.text)).toEqual(["mine"]);
      expect(items(res)[0]!.ownerName).toBe("Alice Member");
    });

    it("includes items whose meeting is gone", async () => {
      await make({ text: "orphan", meetingId: null });

      const [orphan] = items(await list(bob, ""));

      expect(orphan).toMatchObject({
        text: "orphan",
        meetingId: null,
        meetingTitle: null,
      });
    });

    it("pages with a cursor until the last item, without repeats", async () => {
      for (let i = 1; i <= 5; i++) {
        await make({
          text: `item ${i}`,
          dueDate: `2026-12-0${i}`,
        });
      }

      const first = await list(bob, "&limit=2");
      expect(items(first).map((i) => i.text)).toEqual(["item 1", "item 2"]);
      const second = await list(
        bob,
        `&limit=2&cursor=${first.body.responseObject.nextCursor}`,
      );
      expect(items(second).map((i) => i.text)).toEqual(["item 3", "item 4"]);
      const third = await list(
        bob,
        `&limit=2&cursor=${second.body.responseObject.nextCursor}`,
      );
      expect(items(third).map((i) => i.text)).toEqual(["item 5"]);
      expect(third.body.responseObject.nextCursor).toBeNull();
    });

    it("rejects a cursor from another workspace and bad queries", async () => {
      const otherWorkspace = await createWorkspace(outsider.id);
      const foreign = await testPrisma.actionItem.create({
        data: { workspaceId: otherWorkspace.id, text: "foreign" },
      });

      expect((await list(bob, `&cursor=${foreign.id}`)).status).toBe(400);
      expect((await list(bob, "&status=nope")).status).toBe(400);
      expect((await list(bob, "&limit=0")).status).toBe(400);
      expect((await as(app, bob).get("/api/action-items")).status).toBe(400);
    });

    it("answers 404 to a non-member and 401 without a session", async () => {
      expect((await list(outsider, "")).status).toBe(404);
      expect(
        (await request(app).get(`/api/action-items?workspaceId=${workspaceId}`))
          .status,
      ).toBe(401);
    });
  });

  describe("PATCH /api/action-items/:id", () => {
    const patch = (user: TestUser, id: string, body: unknown) =>
      as(app, user)
        .patch(`/api/action-items/${id}`)
        .send(body as object);

    it("lets any member mark an item done and open again", async () => {
      const item = await make({ text: "ship it", ownerUserId: alice.id });

      const done = await patch(bob, item.id, { status: "DONE" });
      expect(done.status).toBe(200);
      expect(done.body.responseObject.status).toBe("DONE");
      const completedAt = done.body.responseObject.completedAt as string;
      expect(Date.parse(completedAt)).not.toBeNaN();

      const again = await patch(bob, item.id, { status: "DONE" });
      expect(again.body.responseObject.completedAt).toBe(completedAt);

      const reopened = await patch(alice, item.id, { status: "OPEN" });
      expect(reopened.body.responseObject).toMatchObject({
        status: "OPEN",
        completedAt: null,
      });
    });

    it("assigns an owner who is a member, replacing the spoken name", async () => {
      const item = await make({ text: "x", ownerName: "Bobby" });

      const res = await patch(alice, item.id, { ownerUserId: bob.id });

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toMatchObject({
        ownerUserId: bob.id,
        ownerName: "Bob Member",
      });
      const stored = await testPrisma.actionItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      expect(stored.ownerName).toBeNull();
    });

    it("clears the owner with null", async () => {
      const item = await make({ text: "x", ownerUserId: bob.id });

      const res = await patch(alice, item.id, { ownerUserId: null });

      expect(res.body.responseObject).toMatchObject({
        ownerUserId: null,
        ownerName: null,
      });
    });

    it("refuses an owner who is not in the workspace", async () => {
      const item = await make({ text: "x" });

      const res = await patch(alice, item.id, { ownerUserId: outsider.id });

      expect(res.status).toBe(400);
      expect(
        (
          await testPrisma.actionItem.findUniqueOrThrow({
            where: { id: item.id },
          })
        ).ownerUserId,
      ).toBeNull();
    });

    it("sets and clears the due date as a calendar date", async () => {
      const item = await make({ text: "x" });

      const set = await patch(alice, item.id, { dueDate: "2026-12-24" });
      expect(set.body.responseObject.dueDate).toBe("2026-12-24");
      const cleared = await patch(alice, item.id, { dueDate: null });
      expect(cleared.body.responseObject.dueDate).toBeNull();
    });

    it("changes the text, trimmed", async () => {
      const item = await make({ text: "old" });

      const res = await patch(alice, item.id, { text: "  new wording  " });

      expect(res.body.responseObject.text).toBe("new wording");
    });

    it.each([
      ["an empty body", {}],
      ["an impossible date", { dueDate: "2026-02-30" }],
      ["a date with a time", { dueDate: "2026-11-13T10:00:00Z" }],
      ["empty text", { text: "   " }],
      ["over-long text", { text: "x".repeat(501) }],
      ["an unknown status", { status: "DOING" }],
    ])("rejects %s with 400", async (_label, body) => {
      const item = await make({ text: "x" });
      expect((await patch(alice, item.id, body)).status).toBe(400);
    });

    it("answers 404 to a non-member and for an unknown item", async () => {
      const item = await make({ text: "x" });

      expect((await patch(outsider, item.id, { status: "DONE" })).status).toBe(
        404,
      );
      expect((await patch(alice, "missing", { status: "DONE" })).status).toBe(
        404,
      );
      expect(
        (
          await testPrisma.actionItem.findUniqueOrThrow({
            where: { id: item.id },
          })
        ).status,
      ).toBe("OPEN");
    });

    it("requires a session", async () => {
      const item = await make({ text: "x" });
      expect(
        (
          await request(app)
            .patch(`/api/action-items/${item.id}`)
            .send({ status: "DONE" })
        ).status,
      ).toBe(401);
    });

    it("broadcasts the meeting's complete item set to the workspace", async () => {
      const item = await make({ text: "first" });
      await make({ text: "second" });

      await patch(alice, item.id, { status: "DONE" });

      const sent = lastBroadcast();
      expect(sent?.room).toBe(workspaceId);
      const payload = sent!.payload as {
        meetingId: string;
        items: Item[];
        removedIds: string[];
      };
      expect(payload.meetingId).toBe(meetingId);
      expect(payload.items.map((i) => i.text).sort()).toEqual([
        "first",
        "second",
      ]);
      expect(payload.items.find((i) => i.text === "first")!.status).toBe(
        "DONE",
      );
      expect(payload.removedIds).toEqual([]);
    });

    it("broadcasts just the changed item when it has no meeting", async () => {
      const item = await make({ text: "orphan", meetingId: null });

      await patch(alice, item.id, { text: "renamed" });

      const payload = lastBroadcast()!.payload as {
        meetingId: string | null;
        items: Item[];
      };
      expect(payload.meetingId).toBeNull();
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]).toMatchObject({ id: item.id, text: "renamed" });
    });

    it("broadcasts nothing for a refused change", async () => {
      const item = await make({ text: "x" });
      await patch(alice, item.id, { ownerUserId: outsider.id });
      await patch(outsider, item.id, { status: "DONE" });
      expect(lastBroadcast()).toBeUndefined();
    });
  });

  describe("DELETE /api/action-items/:id", () => {
    const remove = (user: TestUser, id: string) =>
      as(app, user).delete(`/api/action-items/${id}`);
    const exists = (id: string) =>
      testPrisma.actionItem.count({ where: { id } });

    it("lets an admin and the workspace owner delete any item", async () => {
      const a = await make({ text: "a" });
      const b = await make({ text: "b" });

      expect((await remove(admin, a.id)).status).toBe(200);
      expect((await remove(owner, b.id)).status).toBe(200);
      expect(await exists(a.id)).toBe(0);
      expect(await exists(b.id)).toBe(0);
    });

    it("lets the item's owner and its creator delete it", async () => {
      const owned = await make({ text: "owned", ownerUserId: alice.id });
      const created = await make({ text: "created", createdById: bob.id });

      expect((await remove(alice, owned.id)).status).toBe(200);
      expect((await remove(bob, created.id)).status).toBe(200);
    });

    it("refuses another plain member with 403", async () => {
      const item = await make({
        text: "not yours",
        ownerUserId: alice.id,
        createdById: alice.id,
      });

      const res = await remove(bob, item.id);

      expect(res.status).toBe(403);
      expect(await exists(item.id)).toBe(1);
      expect(lastBroadcast()).toBeUndefined();
    });

    it("answers 404 to a non-member and for an unknown item, 401 without a session", async () => {
      const item = await make({ text: "x" });

      expect((await remove(outsider, item.id)).status).toBe(404);
      expect((await remove(admin, "missing")).status).toBe(404);
      expect(
        (await request(app).delete(`/api/action-items/${item.id}`)).status,
      ).toBe(401);
      expect(await exists(item.id)).toBe(1);
    });

    it("broadcasts the remaining items and the removed id", async () => {
      const gone = await make({ text: "gone" });
      await make({ text: "stays" });

      await remove(admin, gone.id);

      const payload = lastBroadcast()!.payload as {
        meetingId: string;
        items: Item[];
        removedIds: string[];
      };
      expect(payload.meetingId).toBe(meetingId);
      expect(payload.items.map((i) => i.text)).toEqual(["stays"]);
      expect(payload.removedIds).toEqual([gone.id]);
    });

    it("broadcasts only the removed id for an item without a meeting", async () => {
      const orphan = await make({ text: "orphan", meetingId: null });

      await remove(admin, orphan.id);

      expect(lastBroadcast()!.payload).toEqual({
        meetingId: null,
        items: [],
        removedIds: [orphan.id],
      });
    });
  });
});
