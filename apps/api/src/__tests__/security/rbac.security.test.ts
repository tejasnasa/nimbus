/**
 * @module api/__tests__/security/rbac
 * @description The role ladder, exercised over HTTP: OWNER > ADMIN > MEMBER.
 *
 * The invariants under test are the ones that decide who can take over a
 * workspace — OWNER is sole and immutable, nobody can be promoted to OWNER, and
 * an ADMIN cannot mint another ADMIN. Each is a privilege-escalation guard, so
 * they're asserted on the response *and* on the resulting database state.
 */
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import {
  addMember,
  as,
  closeTestResources,
  createDocument,
  createWorkspace,
  mintUser,
  resetDatabase,
  signWebhook,
  testPrisma,
  type TestUser,
} from "@testhelpers";

const app = createApp();

afterAll(closeTestResources);

describe("security: RBAC", () => {
  let owner: TestUser;
  let admin: TestUser;
  let member: TestUser;
  let wsId: string;

  beforeEach(async () => {
    await resetDatabase();

    owner = await mintUser(app);
    admin = await mintUser(app);
    member = await mintUser(app);

    const ws = await createWorkspace(owner.id);
    wsId = ws.id;
    await addMember(wsId, admin.id, "ADMIN");
    await addMember(wsId, member.id, "MEMBER");
  });

  const roleOf = async (userId: string) =>
    (
      await testPrisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: wsId } },
      })
    )?.role;

  describe("promotion", () => {
    it("forbids promoting anyone to OWNER", async () => {
      const res = await as(app, owner)
        .put(`/api/workspace/role/${wsId}`)
        .send({ memberId: member.id, role: "OWNER" });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/cannot make someone owner/i);
      await expect(roleOf(member.id)).resolves.toBe("MEMBER");
    });

    it("forbids changing the OWNER's role", async () => {
      const res = await as(app, admin)
        .put(`/api/workspace/role/${wsId}`)
        .send({ memberId: owner.id, role: "MEMBER" });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/cannot change owner/i);
      await expect(roleOf(owner.id)).resolves.toBe("OWNER");
    });

    it("forbids an ADMIN minting another ADMIN", async () => {
      const res = await as(app, admin)
        .put(`/api/workspace/role/${wsId}`)
        .send({ memberId: member.id, role: "ADMIN" });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/cannot make someone admin/i);
      await expect(roleOf(member.id)).resolves.toBe("MEMBER");
    });

    it("forbids a MEMBER changing anyone's role", async () => {
      const res = await as(app, member)
        .put(`/api/workspace/role/${wsId}`)
        .send({ memberId: admin.id, role: "MEMBER" });

      expect(res.status).toBe(403);
      await expect(roleOf(admin.id)).resolves.toBe("ADMIN");
    });

    it("allows the OWNER to promote a MEMBER to ADMIN", async () => {
      const res = await as(app, owner)
        .put(`/api/workspace/role/${wsId}`)
        .send({ memberId: member.id, role: "ADMIN" });

      expect(res.status).toBe(200);
      await expect(roleOf(member.id)).resolves.toBe("ADMIN");
    });

    it("allows an ADMIN to demote a MEMBER (but not to ADMIN)", async () => {
      const res = await as(app, admin)
        .put(`/api/workspace/role/${wsId}`)
        .send({ memberId: member.id, role: "MEMBER" });

      expect(res.status).toBe(200);
    });
  });

  describe("membership removal", () => {
    it("forbids a MEMBER removing anyone", async () => {
      const res = await as(app, member)
        .delete(`/api/workspace/leave/${wsId}`)
        .send({ memberId: admin.id });

      expect(res.status).toBe(403);
    });

    it("forbids removing the OWNER", async () => {
      const res = await as(app, admin)
        .delete(`/api/workspace/leave/${wsId}`)
        .send({ memberId: owner.id });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/cannot remove owner/i);
      await expect(roleOf(owner.id)).resolves.toBe("OWNER");
    });

    it("allows an ADMIN to remove a MEMBER", async () => {
      const res = await as(app, admin)
        .delete(`/api/workspace/leave/${wsId}`)
        .send({ memberId: member.id });

      expect(res.status).toBe(200);
      await expect(roleOf(member.id)).resolves.toBeUndefined();
    });
  });

  describe("invite-code rotation", () => {
    it("forbids a MEMBER rotating the invite code", async () => {
      const res = await as(app, member).put(`/api/workspace/regenerate-invite/${wsId}`);

      expect(res.status).toBe(403);
    });

    it("allows an ADMIN to rotate the invite code, invalidating the old one", async () => {
      const before = await testPrisma.workspace.findUniqueOrThrow({ where: { id: wsId } });

      const res = await as(app, admin).put(`/api/workspace/regenerate-invite/${wsId}`);

      expect(res.status).toBe(200);
      expect(res.body.responseObject.inviteCode).not.toBe(before.inviteCode);

      const after = await testPrisma.workspace.findUniqueOrThrow({ where: { id: wsId } });
      expect(after.inviteCode).not.toBe(before.inviteCode);
    });
  });

  describe("workspace deletion", () => {
    it("forbids an ADMIN deleting the workspace", async () => {
      const res = await as(app, admin).delete(`/api/workspace/delete/${wsId}`);

      expect(res.status).toBe(403);
      await expect(
        testPrisma.workspace.findUnique({ where: { id: wsId } }),
      ).resolves.not.toBeNull();
    });
  });

  describe("document deletion", () => {
    it("forbids a MEMBER deleting a document", async () => {
      const doc = await createDocument(wsId);

      const res = await as(app, member).delete(`/api/document/${doc.id}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/only admins and owners/i);
    });

    it("allows an ADMIN to delete a document", async () => {
      const doc = await createDocument(wsId);

      const res = await as(app, admin).delete(`/api/document/${doc.id}`);

      expect(res.status).toBe(200);
      await expect(
        testPrisma.document.findUnique({ where: { id: doc.id } }),
      ).resolves.toBeNull();
    });
  });

  describe("voice", () => {
    it("issues a call token to a member and to nobody outside the workspace", async () => {
      const outsider = await mintUser(app);

      const ok = await as(app, member)
        .post("/api/voice/token")
        .send({ workspaceId: wsId });
      const denied = await as(app, outsider)
        .post("/api/voice/token")
        .send({ workspaceId: wsId });

      expect(ok.status).toBe(200);
      expect(denied.status).toBe(404);
      expect(denied.body.responseObject).toBeNull();
    });

    it("hides the roster from a non-member", async () => {
      const outsider = await mintUser(app);

      const res = await as(app, outsider).get(`/api/voice/${wsId}/roster`);

      expect(res.status).toBe(404);
    });

    it("rejects an unsigned webhook delivery without changing the roster", async () => {
      const { body } = await signWebhook({
        event: "participant_joined",
        room: { name: `nimbus-ws-${wsId}` },
        participant: { identity: member.id, name: "Mallory" },
      });

      const res = await request(app)
        .post("/api/livekit/webhook")
        .set("Content-Type", "application/webhook+json")
        .send(body);

      expect(res.status).toBe(401);
      expect(res.text).toBe("");
      const roster = await as(app, owner).get(`/api/voice/${wsId}/roster`);
      expect(roster.body.responseObject.users).toEqual([]);
    });

    it("rejects a webhook signed with a key other than the project's", async () => {
      const { body, authorization } = await signWebhook(
        {
          event: "participant_joined",
          room: { name: `nimbus-ws-${wsId}` },
          participant: { identity: member.id, name: "Mallory" },
        },
        "an-attackers-secret",
      );

      const res = await request(app)
        .post("/api/livekit/webhook")
        .set("Content-Type", "application/webhook+json")
        .set("Authorization", authorization)
        .send(body);

      expect(res.status).toBe(401);
    });

    it("no longer serves the relay credentials endpoint", async () => {
      const res = await as(app, member).get("/api/turn/credentials");

      expect(res.status).toBe(404);
    });
  });
});
