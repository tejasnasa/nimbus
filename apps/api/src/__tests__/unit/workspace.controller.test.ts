/**
 * @module api/__tests__/unit/workspace.controller
 * @description Controller-level behaviour that the HTTP suites don't reach: the
 * exact rows `createWorkspace` seeds, invite-code rotation invalidating the old
 * code, and what the delete cascade actually removes.
 *
 * Assertions are on returned `ServerResponse`s *and* on database state, because
 * a controller can report success while writing nothing.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkspace,
  deleteWorkspace,
  getMyWorkspaces,
  getWorkspaceBySlugId,
  joinWorkspace,
  regenerateInviteCode,
  removeMember,
  updateMemberRole,
  updateWorkspace,
} from "../../controllers/workspace.controller";
import {
  addMember,
  closeTestResources,
  createUser,
  resetDatabase,
  testPrisma,
} from "@testhelpers";

afterAll(closeTestResources);

describe("controllers/workspace", () => {
  beforeEach(resetDatabase);

  describe("createWorkspace", () => {
    it("seeds a canvas, a markdown doc, the creator as OWNER and the bot as ADMIN", async () => {
      const creator = await createUser("Creator");

      const response = await createWorkspace(
        "My Workspace",
        "desc",
        creator.id,
      );
      expect(response.statusCode).toBe(201);

      const wsId = response.responseObject.workspaceId;

      const documents = await testPrisma.document.findMany({
        where: { workspaceId: wsId },
      });
      expect(documents.map((d) => d.type).sort()).toEqual([
        "CANVAS",
        "MARKDOWN",
      ]);

      const members = await testPrisma.workspaceMember.findMany({
        where: { workspaceId: wsId },
      });
      expect(members).toHaveLength(2);
      expect(members.find((m) => m.userId === creator.id)?.role).toBe("OWNER");
      expect(
        members.find((m) => m.userId === process.env.BOT_USERID)?.role,
      ).toBe("ADMIN");
    });

    it("generates a slug and a unique invite code", async () => {
      const creator = await createUser("Creator");

      const first = await createWorkspace("Slugged Workspace", "", creator.id);
      const second = await createWorkspace("Slugged Workspace", "", creator.id);

      expect(first.responseObject.slug).toBeTruthy();
      expect(first.responseObject.inviteCode).toBeTruthy();
      expect(second.responseObject.inviteCode).not.toBe(
        first.responseObject.inviteCode,
      );
      expect(second.responseObject.slugId).not.toBe(
        first.responseObject.slugId,
      );
    });
  });

  describe("joinWorkspace", () => {
    it("adds the joiner as a MEMBER and returns the routing info", async () => {
      const owner = await createUser("Owner");
      const joiner = await createUser("Joiner");
      const created = await createWorkspace("Joinable", "", owner.id);
      const { inviteCode, slug, slugId } = created.responseObject;

      const response = await joinWorkspace(inviteCode, joiner.id);

      expect(response.statusCode).toBe(200);
      expect(response.responseObject).toEqual({ slug, slugId });
      await expect(
        testPrisma.workspaceMember.findUnique({
          where: {
            userId_workspaceId: {
              userId: joiner.id,
              workspaceId: created.responseObject.workspaceId,
            },
          },
        }),
      ).resolves.toMatchObject({ role: "MEMBER" });
    });

    it("rejects a second join", async () => {
      const owner = await createUser("Owner");
      const joiner = await createUser("Joiner");
      const { inviteCode } = (await createWorkspace("Joinable", "", owner.id))
        .responseObject;

      await joinWorkspace(inviteCode, joiner.id);
      const again = await joinWorkspace(inviteCode, joiner.id);

      expect(again.statusCode).toBe(400);
      expect(again.message).toMatch(/already a member/i);
    });

    it("rejects an unknown invite code", async () => {
      const joiner = await createUser("Joiner");

      const response = await joinWorkspace("no-such-code", joiner.id);

      expect(response.statusCode).toBe(404);
    });
  });

  describe("getMyWorkspaces", () => {
    it("returns only the caller's workspaces", async () => {
      const mine = await createUser("Mine");
      const theirs = await createUser("Theirs");
      await createWorkspace("Mine", "", mine.id);
      await createWorkspace("Theirs", "", theirs.id);

      const response = await getMyWorkspaces(mine.id);

      expect(response.statusCode).toBe(200);
      expect(response.responseObject).toHaveLength(1);
      expect(response.responseObject[0].name).toBe("Mine");
    });

    it("includes workspaces joined rather than created", async () => {
      const owner = await createUser("Owner");
      const joiner = await createUser("Joiner");
      const created = await createWorkspace("Shared", "", owner.id);
      await addMember(created.responseObject.workspaceId, joiner.id);

      const response = await getMyWorkspaces(joiner.id);

      expect(response.responseObject).toHaveLength(1);
    });
  });

  describe("getWorkspaceBySlugId", () => {
    it("returns the workspace to a member", async () => {
      const owner = await createUser("Owner");
      const { slugId } = (await createWorkspace("Visible", "", owner.id))
        .responseObject;

      const response = await getWorkspaceBySlugId(String(slugId), owner.id);

      expect(response.statusCode).toBe(200);
      expect(response.responseObject.name).toBe("Visible");
    });

    it("hides the workspace from a non-member as 404", async () => {
      const owner = await createUser("Owner");
      const outsider = await createUser("Outsider");
      const { slugId } = (await createWorkspace("Hidden", "", owner.id))
        .responseObject;

      const response = await getWorkspaceBySlugId(String(slugId), outsider.id);

      expect(response.statusCode).toBe(404);
    });

    it("returns 400 for a non-numeric slug", async () => {
      const caller = await createUser("Caller");

      // Garbage input is permanently bad — 400, not 500.
      const response = await getWorkspaceBySlugId("not-a-number", caller.id);

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for a slug of zero", async () => {
      const caller = await createUser("Caller");

      const response = await getWorkspaceBySlugId("0", caller.id);

      expect(response.statusCode).toBe(400);
    });
  });

  describe("regenerateInviteCode", () => {
    it("rotates the code and invalidates the previous one", async () => {
      const owner = await createUser("Owner");
      const joiner = await createUser("Joiner");
      const created = await createWorkspace("Rotating", "", owner.id);
      const original = created.responseObject.inviteCode;

      const response = await regenerateInviteCode(
        created.responseObject.workspaceId,
        owner.id,
      );

      expect(response.statusCode).toBe(200);
      expect(response.responseObject.inviteCode).not.toBe(original);
      await expect(joinWorkspace(original, joiner.id)).resolves.toMatchObject({
        statusCode: 404,
      });
    });

    it("forbids a plain MEMBER from rotating it", async () => {
      const owner = await createUser("Owner");
      const member = await createUser("Member");
      const created = await createWorkspace("Rotating", "", owner.id);
      await addMember(created.responseObject.workspaceId, member.id, "MEMBER");

      const response = await regenerateInviteCode(
        created.responseObject.workspaceId,
        member.id,
      );

      expect(response.statusCode).toBe(403);
    });
  });

  describe("updateMemberRole", () => {
    it("refuses to promote anyone to OWNER", async () => {
      const owner = await createUser("Owner");
      const member = await createUser("Member");
      const created = await createWorkspace("Roles", "", owner.id);
      await addMember(created.responseObject.workspaceId, member.id, "MEMBER");

      const response = await updateMemberRole(
        created.responseObject.workspaceId,
        owner.id,
        member.id,
        "OWNER",
      );

      expect(response.statusCode).toBe(403);
    });
  });

  describe("removeMember", () => {
    it("refuses to remove the OWNER", async () => {
      const owner = await createUser("Owner");
      const admin = await createUser("Admin");
      const created = await createWorkspace("Removals", "", owner.id);
      await addMember(created.responseObject.workspaceId, admin.id, "ADMIN");

      const response = await removeMember(
        created.responseObject.workspaceId,
        admin.id,
        owner.id,
      );

      expect(response.statusCode).toBe(403);
    });
  });

  describe("updateWorkspace", () => {
    it("forbids a plain MEMBER from renaming it", async () => {
      const owner = await createUser("Owner");
      const member = await createUser("Member");
      const created = await createWorkspace("Original", "", owner.id);
      await addMember(created.responseObject.workspaceId, member.id, "MEMBER");

      const response = await updateWorkspace(
        created.responseObject.workspaceId,
        member.id,
        "Renamed",
        "",
      );

      expect(response.statusCode).toBe(403);
    });

    it("lets an ADMIN rename it", async () => {
      const owner = await createUser("Owner");
      const admin = await createUser("Admin");
      const created = await createWorkspace("Original", "", owner.id);
      await addMember(created.responseObject.workspaceId, admin.id, "ADMIN");

      const response = await updateWorkspace(
        created.responseObject.workspaceId,
        admin.id,
        "Renamed",
        "new description",
      );

      expect(response.statusCode).toBe(200);
    });

    it("returns 404 when the workspace does not exist", async () => {
      const caller = await createUser("Caller");

      const response = await updateWorkspace(
        "clxxxxxxxxxxxxxxxxxxxxxx",
        caller.id,
        "Anything",
        "",
      );

      expect(response.statusCode).toBe(404);
    });
  });

  describe("deleteWorkspace", () => {
    it("cascades to documents and members", async () => {
      const owner = await createUser("Owner");
      const created = await createWorkspace("Doomed", "", owner.id);
      const wsId = created.responseObject.workspaceId;

      const response = await deleteWorkspace(wsId, owner.id);

      expect(response.statusCode).toBe(200);
      await expect(
        testPrisma.workspace.findUnique({ where: { id: wsId } }),
      ).resolves.toBeNull();
      await expect(
        testPrisma.document.count({ where: { workspaceId: wsId } }),
      ).resolves.toBe(0);
      await expect(
        testPrisma.workspaceMember.count({ where: { workspaceId: wsId } }),
      ).resolves.toBe(0);
    });

    it("returns 404 when the workspace does not exist", async () => {
      const owner = await createUser("Owner");

      const response = await deleteWorkspace(
        "clxxxxxxxxxxxxxxxxxxxxxx",
        owner.id,
      );

      expect(response.statusCode).toBe(404);
    });
  });
});
