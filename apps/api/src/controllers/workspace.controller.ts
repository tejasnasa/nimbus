/**
 * @module api/controllers/workspace
 * @description Workspace lifecycle + RBAC: creation transaction (workspace,
 * OWNER membership, seeded CANVAS/MARKDOWN docs, NimbusBot ADMIN), member
 * reads scoped by membership, invite join, and ADMIN/OWNER-gated mutations.
 * Role ladder: OWNER (sole, immutable) > ADMIN > MEMBER.
 *
 * @important Role invariants — OWNER can never be reassigned, demoted, or
 *            removed; ADMINs cannot promote to ADMIN. Creation requires
 *            BOT_USERID for the bot membership row.
 */
import { prisma } from "@nimbus/db";
import { ServerResponse } from "@nimbus/types";
import { generateSlug } from "@nimbus/utils";
import cuid from "cuid";

/**
 * Creates a workspace with default documents and bot membership.
 *
 * Runs inside a Prisma transaction that creates the workspace, adds the
 * creator as OWNER, seeds one CANVAS + one MARKDOWN doc, and adds NimbusBot
 * as ADMIN.
 *
 * @param name - Display name for the workspace.
 * @param description - Workspace description.
 * @param id - Authenticated user's ID (becomes OWNER).
 * @returns ServerResponse with the created workspace summary or an error.
 */
export const createWorkspace = async (
  name: string,
  description: string,
  id: string,
) => {
  try {
    const slug = generateSlug(name);

    const workspace = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name,
          slug,
          description,
        },
      });

      const memb = await tx.workspaceMember.create({
        data: {
          userId: id,
          workspaceId: ws.id,
          role: "OWNER",
        },
      });

      await tx.document.create({
        data: {
          title: "New Canvas",
          canvasData: [],
          workspaceId: ws.id,
          type: "CANVAS",
        },
      });

      await tx.document.create({
        data: {
          title: "New Document",
          workspaceId: ws.id,
          type: "MARKDOWN",
        },
      });

      await tx.workspaceMember.create({
        data: {
          userId: process.env.BOT_USERID!,
          workspaceId: ws.id,
          role: "ADMIN",
        },
      });

      return {
        workspaceId: ws.id,
        name: ws.name,
        slug: ws.slug,
        slugId: ws.slugId,
        creatorId: memb.userId,
        inviteCode: ws.inviteCode,
      };
    });

    return ServerResponse.created(workspace, "Workspace created");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Lists workspaces the user belongs to, newest-first.
 *
 * @param id - Authenticated user's ID.
 * @returns Workspaces with member id/image/role summaries.
 */
export const getMyWorkspaces = async (id: string) => {
  try {
    const workspaces = await prisma.workspace.findMany({
      where: {
        members: {
          some: {
            userId: id,
          },
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        slug: true,
        slugId: true,
        inviteCode: true,
        updatedAt: true,
        members: {
          select: {
            role: true,
            user: {
              select: {
                id: true,
                image: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (!workspaces) {
      return ServerResponse.ok([], "No workspaces found");
    }

    return ServerResponse.ok(
      workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        description: ws.description ?? "",
        slug: ws.slug,
        slugId: ws.slugId,
        inviteCode: ws.inviteCode,
        updatedAt: ws.updatedAt.toISOString(),
        members: ws.members.map((m) => ({
          id: m.user.id,
          image: m.user.image,
          role: m.role,
        })),
      })),
      "Workspaces retrieved",
    );
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Fetches one workspace by URL slug id, membership-scoped.
 *
 * 404 covers both missing workspaces and non-members (avoids leaking
 * existence to outsiders); 400 covers a slug that is not an id at all.
 *
 * @param slugId - Auto-increment URL identifier (stringified int).
 * @param id - Authenticated user's ID (must be a member).
 * @returns The workspace, or 400/404.
 */
export const getWorkspaceBySlugId = async (slugId: string, id: string) => {
  // A path segment is unvalidated input: a stale link, a crawler or a typo
  // reaches here as easily as a real id. `parseInt` would hand Prisma a `NaN`,
  // which is not a valid `Int` and surfaces as a validation throw — reported to
  // the caller as a 500 for what is permanently bad input.
  const parsedSlugId = Number(slugId);
  if (!Number.isInteger(parsedSlugId) || parsedSlugId <= 0) {
    return ServerResponse.badRequest("Invalid workspace id");
  }

  try {
    const workspace = await prisma.workspace.findFirst({
      where: {
        slugId: parsedSlugId,
        members: {
          some: {
            userId: id,
          },
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        slug: true,
        slugId: true,
        inviteCode: true,
        updatedAt: true,
        members: {
          select: {
            role: true,
            user: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
      },
    });

    if (!workspace) {
      return ServerResponse.notFound("Workspace not found or access denied");
    }

    return ServerResponse.ok(
      {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description ?? "",
        slug: workspace.slug,
        slugId: workspace.slugId,
        inviteCode: workspace.inviteCode,
        updatedAt: workspace.updatedAt.toISOString(),
        members: workspace.members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          image: m.user.image,
          role: m.role,
        })),
      },
      "Workspace retrieved",
    );
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Joins a workspace via invite code (default MEMBER role).
 *
 * @param inviteCode - Workspace invite code.
 * @param id - Joining user's ID; rejected when already a member.
 */
export const joinWorkspace = async (inviteCode: string, id: string) => {
  try {
    const workspace = await prisma.workspace.findFirst({
      where: {
        inviteCode,
      },
      include: {
        members: true,
      },
    });

    if (!workspace) {
      return ServerResponse.notFound("Invalid invite code");
    }

    if (workspace.members.some((member) => member.userId === id)) {
      return ServerResponse.badRequest("Already a member of this workspace");
    }

    await prisma.workspaceMember.create({
      data: {
        userId: id,
        workspaceId: workspace.id,
      },
    });

    return ServerResponse.ok(
      { slug: workspace.slug, slugId: workspace.slugId },
      "Joined workspace",
    );
  } catch (error) {
    console.error("Full error:", JSON.stringify(error, null, 2));
    return ServerResponse.internalError(error);
  }
};

/**
 * Rotates the invite code (ADMIN/OWNER only, invalidates the old code).
 *
 * @param wsid - Workspace cuid.
 * @param id - Acting user's ID.
 */
export const regenerateInviteCode = async (wsid: string, id: string) => {
  try {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: id,
          workspaceId: wsid,
        },
      },
    });

    if (member?.role !== "ADMIN" && member?.role !== "OWNER") {
      return ServerResponse.forbidden("Access denied");
    }

    const newInviteCode = cuid();

    await prisma.workspace.update({
      where: {
        id: wsid,
      },
      data: {
        inviteCode: newInviteCode,
      },
    });

    return ServerResponse.ok(
      { inviteCode: newInviteCode },
      "Invite code regenerated",
    );
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Changes a member's role, enforcing the OWNER/ADMIN invariants.
 *
 * Guards: caller must be ADMIN/OWNER; nobody can be made OWNER; the OWNER's
 * role is immutable; ADMINs cannot promote others to ADMIN.
 *
 * @param wsid - Workspace cuid.
 * @param id - Acting user's ID.
 * @param memberId - Target member's user ID.
 * @param role - Desired role (OWNER requests are always rejected).
 */
export const updateMemberRole = async (
  wsid: string,
  id: string,
  memberId: string,
  role: "OWNER" | "ADMIN" | "MEMBER",
) => {
  try {
    const loggedInUser = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: id,
          workspaceId: wsid,
        },
      },
    });

    if (loggedInUser?.role !== "ADMIN" && loggedInUser?.role !== "OWNER") {
      return ServerResponse.forbidden("Access denied");
    }

    if (role === "OWNER") {
      return ServerResponse.forbidden("You cannot make someone owner");
    }

    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: memberId,
          workspaceId: wsid,
        },
      },
    });

    if (member?.role === "OWNER") {
      return ServerResponse.forbidden("You cannot change owner's role");
    }

    if (loggedInUser.role === "ADMIN" && role === "ADMIN") {
      return ServerResponse.forbidden("You cannot make someone admin");
    }

    await prisma.workspaceMember.update({
      where: {
        userId_workspaceId: {
          userId: memberId,
          workspaceId: wsid,
        },
      },
      data: {
        role,
      },
    });

    return ServerResponse.ok({ role }, "Member role updated");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Removes a member (ADMIN/OWNER only; OWNER is unremovable).
 *
 * @param wsid - Workspace cuid.
 * @param id - Acting user's ID.
 * @param memberId - Member to remove.
 */
export const removeMember = async (
  wsid: string,
  id: string,
  memberId: string,
) => {
  try {
    const loggedInUser = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: id,
          workspaceId: wsid,
        },
      },
    });

    if (loggedInUser?.role !== "ADMIN" && loggedInUser?.role !== "OWNER") {
      return ServerResponse.forbidden("Access denied");
    }

    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: memberId,
          workspaceId: wsid,
        },
      },
    });

    if (member?.role === "OWNER") {
      return ServerResponse.forbidden("You cannot remove owner");
    }

    await prisma.workspaceMember.delete({
      where: {
        userId_workspaceId: {
          userId: memberId,
          workspaceId: wsid,
        },
      },
    });

    return ServerResponse.ok({}, "Member removed");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Renames / re-describes a workspace (ADMIN/OWNER only, members excluded).
 *
 * @param wsid - Workspace cuid.
 * @param id - Acting user's ID (must be a member, then ADMIN/OWNER).
 * @param name - New display name.
 * @param description - New description.
 */
export const updateWorkspace = async (
  wsid: string,
  id: string,
  name: string,
  description: string,
) => {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: {
        id: wsid,
      },
      include: {
        members: true,
      },
    });

    if (!workspace) {
      return ServerResponse.notFound("Workspace not found");
    }

    const isMember = workspace.members.some((member) => member.userId === id);

    if (!isMember) {
      return ServerResponse.forbidden("Access denied");
    }

    const isOwner = workspace.members.some(
      (member) =>
        member.userId === id &&
        (member.role === "OWNER" || member.role === "ADMIN"),
    );

    if (!isOwner) {
      return ServerResponse.forbidden("Access denied");
    }

    const updatedWorkspace = await prisma.workspace.update({
      where: {
        id: wsid,
      },
      data: {
        name,
        description,
      },
    });

    return ServerResponse.ok(updatedWorkspace, "Workspace updated");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Deletes a workspace (OWNER only; cascades to documents/members via schema).
 *
 * @param wsid - Workspace cuid.
 * @param id - Acting user's ID (must hold the OWNER role).
 */
export const deleteWorkspace = async (wsid: string, id: string) => {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: {
        id: wsid,
      },
      include: {
        members: true,
      },
    });

    if (!workspace) {
      return ServerResponse.notFound("Workspace not found");
    }

    const isMember = workspace.members.some((member) => member.userId === id);

    if (!isMember) {
      return ServerResponse.forbidden("Access denied");
    }

    const isOwner = workspace.members.some(
      (member) => member.userId === id && member.role === "OWNER",
    );

    if (!isOwner) {
      return ServerResponse.forbidden("Access denied");
    }

    await prisma.workspace.delete({
      where: {
        id: wsid,
      },
    });

    return ServerResponse.ok(null, "Workspace deleted");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};
