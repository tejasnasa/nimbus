/**
 * @module api/__tests__/integration/http/workspace
 * @description Workspace lifecycle over HTTP: create (and what it seeds), list,
 * slug lookup, rename, delete, invite-code join, and member removal.
 *
 * Assertions check the response *and* the row it implies, so a controller that
 * reports success without writing is caught.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app";
import {
  addMember,
  as,
  closeTestResources,
  createUser,
  createWorkspace,
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";

const app = createApp();

afterAll(closeTestResources);

describe("http: workspace", () => {
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    owner = await mintUser(app);
    member = await mintUser(app);
    outsider = await mintUser(app);
  });

  describe("POST /api/workspace/create", () => {
    it("creates the workspace and makes the caller OWNER", async () => {
      const res = await as(app, owner)
        .post("/api/workspace/create")
        .send({ name: "My Workspace", description: "hello" });

      expect(res.status).toBe(201);
      expect(res.body.responseObject).toMatchObject({ name: "My Workspace" });

      const wsId = res.body.responseObject.workspaceId;
      await expect(
        testPrisma.workspaceMember.findUnique({
          where: { userId_workspaceId: { userId: owner.id, workspaceId: wsId } },
        }),
      ).resolves.toMatchObject({ role: "OWNER" });
    });

    it("rejects a name that is too short", async () => {
      const res = await as(app, owner)
        .post("/api/workspace/create")
        .send({ name: "ab", description: "" });

      expect(res.status).toBe(400);
      expect(res.body.responseObject.properties.name.errors[0]).toMatch(/at least 3/i);
    });

    it("rejects a name beyond the schema's maximum", async () => {
      const res = await as(app, owner)
        .post("/api/workspace/create")
        .send({ name: "x".repeat(26), description: "" });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/workspace", () => {
    it("lists only the caller's workspaces", async () => {
      const mine = await createWorkspace(owner.id, "Mine");
      await createWorkspace(outsider.id, "Theirs");

      const res = await as(app, owner).get("/api/workspace");

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toHaveLength(1);
      expect(res.body.responseObject[0].id).toBe(mine.id);
    });

    it("returns an empty list for a user with no workspaces", async () => {
      const res = await as(app, owner).get("/api/workspace");

      expect(res.body.responseObject).toEqual([]);
    });
  });

  describe("GET /api/workspace/:slugId", () => {
    it("returns a workspace the caller belongs to", async () => {
      const ws = await createWorkspace(owner.id, "Findable");

      const res = await as(app, owner).get(`/api/workspace/${ws.slugId}`);

      expect(res.status).toBe(200);
      expect(res.body.responseObject.name).toBe("Findable");
    });

    it("hides a workspace the caller does not belong to", async () => {
      const ws = await createWorkspace(outsider.id, "Private");

      const res = await as(app, owner).get(`/api/workspace/${ws.slugId}`);

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/workspace/update/:wsid", () => {
    it("renames for an OWNER", async () => {
      const ws = await createWorkspace(owner.id, "Before");

      const res = await as(app, owner)
        .put(`/api/workspace/update/${ws.id}`)
        .send({ name: "After", description: "" });

      expect(res.status).toBe(200);
      await expect(
        testPrisma.workspace.findUnique({ where: { id: ws.id } }),
      ).resolves.toMatchObject({ name: "After" });
    });

    it("refuses a plain MEMBER", async () => {
      const ws = await createWorkspace(owner.id, "Before");
      await addMember(ws.id, member.id, "MEMBER");

      const res = await as(app, member)
        .put(`/api/workspace/update/${ws.id}`)
        .send({ name: "Hijacked", description: "" });

      expect(res.status).toBe(403);
      await expect(
        testPrisma.workspace.findUnique({ where: { id: ws.id } }),
      ).resolves.toMatchObject({ name: "Before" });
    });
  });

  describe("DELETE /api/workspace/delete/:wsid", () => {
    it("deletes for the OWNER", async () => {
      const ws = await createWorkspace(owner.id);

      const res = await as(app, owner).delete(`/api/workspace/delete/${ws.id}`);

      expect(res.status).toBe(200);
      await expect(
        testPrisma.workspace.findUnique({ where: { id: ws.id } }),
      ).resolves.toBeNull();
    });

    it("refuses an ADMIN", async () => {
      const ws = await createWorkspace(owner.id);
      await addMember(ws.id, member.id, "ADMIN");

      const res = await as(app, member).delete(`/api/workspace/delete/${ws.id}`);

      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/workspace/join", () => {
    it("joins with a valid invite code as MEMBER", async () => {
      const ws = await createWorkspace(owner.id);

      const res = await as(app, outsider)
        .post("/api/workspace/join")
        .send({ inviteCode: ws.inviteCode });

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toMatchObject({ slug: ws.slug, slugId: ws.slugId });
      await expect(
        testPrisma.workspaceMember.findUnique({
          where: { userId_workspaceId: { userId: outsider.id, workspaceId: ws.id } },
        }),
      ).resolves.toMatchObject({ role: "MEMBER" });
    });

    it("rejects an unknown invite code", async () => {
      const res = await as(app, outsider)
        .post("/api/workspace/join")
        .send({ inviteCode: "not-a-code" });

      expect(res.status).toBe(404);
    });

    it("rejects joining twice", async () => {
      const ws = await createWorkspace(owner.id);
      await as(app, outsider).post("/api/workspace/join").send({ inviteCode: ws.inviteCode });

      const again = await as(app, outsider)
        .post("/api/workspace/join")
        .send({ inviteCode: ws.inviteCode });

      expect(again.status).toBe(400);
    });
  });

  describe("DELETE /api/workspace/leave/:wsid", () => {
    it("removes a member at an OWNER's request", async () => {
      const ws = await createWorkspace(owner.id);
      await addMember(ws.id, member.id, "MEMBER");

      const res = await as(app, owner)
        .delete(`/api/workspace/leave/${ws.id}`)
        .send({ memberId: member.id });

      expect(res.status).toBe(200);
      await expect(
        testPrisma.workspaceMember.findUnique({
          where: { userId_workspaceId: { userId: member.id, workspaceId: ws.id } },
        }),
      ).resolves.toBeNull();
    });

    it("refuses to remove the OWNER", async () => {
      const ws = await createWorkspace(owner.id);
      await addMember(ws.id, member.id, "ADMIN");

      const res = await as(app, member)
        .delete(`/api/workspace/leave/${ws.id}`)
        .send({ memberId: owner.id });

      expect(res.status).toBe(403);
    });
  });
});
