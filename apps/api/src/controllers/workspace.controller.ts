import { prisma } from "@nimbus/db";
import { ServerResponse } from "@nimbus/types";
import { generateSlug } from "@nimbus/utils";

export const createWorkspace = async (name: string, id: string) => {
  try {
    const slug = generateSlug(name);

    const workspace = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name,
          slug,
        },
      });

      const memb = await tx.workspaceMember.create({
        data: {
          userId: id,
          workspaceId: ws.id,
          role: "OWNER",
        },
      });

      return {
        workspaceId: ws.id,
        name: ws.name,
        slug: ws.slug,
        slugId: ws.slugId,
        creatorId: memb.userId,
      };
    });

    return ServerResponse.created(workspace, "Workspace created");
  } catch (error) {
    return ServerResponse.internalError();
  }
};

export const getMyWorkspaces = async () => {};

export const getWorkspaceById = async () => {};

export const deleteWorkspace = async () => {};
