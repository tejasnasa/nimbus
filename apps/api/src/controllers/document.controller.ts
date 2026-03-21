import { prisma } from "@nimbus/db";
import { ServerResponse } from "@nimbus/types";
import { docs } from "../socket/document";

export const createDocument = async (
  title: string,
  workspaceId: string,
  userId: string,
) => {
  try {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId },
      },
    });
    if (!member) return ServerResponse.forbidden("Not a member");

    const document = await prisma.document.create({
      data: { title, workspaceId },
    });
    return ServerResponse.ok(document);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

export const getWorkspaceDocuments = async (
  workspaceId: string,
  userId: string,
) => {
  try {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId },
      },
    });
    if (!member) return ServerResponse.forbidden("Not a member");

    const documents = await prisma.document.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    });
    return ServerResponse.ok(documents);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

export const getDocument = async (docId: string, userId: string) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: docId },
      include: { workspace: { include: { members: true } } },
    });
    if (!document) return ServerResponse.notFound("Document not found");

    const isMember = document.workspace.members.some(
      (m) => m.userId === userId,
    );
    if (!isMember) return ServerResponse.forbidden("Not a member");

    return ServerResponse.ok(document);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

export const deleteDocument = async (docId: string, userId: string) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: docId },
      include: { workspace: { include: { members: true } } },
    });
    if (!document) return ServerResponse.notFound("Document not found");

    const member = document.workspace.members.find((m) => m.userId === userId);
    if (!member) return ServerResponse.forbidden("Not a member");
    if (member.role === "MEMBER")
      return ServerResponse.forbidden(
        "Only admins and owners can delete documents",
      );

    await prisma.document.delete({ where: { id: docId } });
    docs.delete(`doc:${docId}`);
    return ServerResponse.ok("Document deleted");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};
