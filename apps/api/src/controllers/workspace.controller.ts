import { prisma } from "@nimbus/db";
import { ServerResponse } from "@nimbus/types";
import { generateSlug } from "@nimbus/utils";
import cuid from "cuid";

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
          userId: process.env.BOT_USERID,
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

export const getWorkspaceBySlugId = async (slugId: string, id: string) => {
  try {
    const workspace = await prisma.workspace.findFirst({
      where: {
        slugId: parseInt(slugId),
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
