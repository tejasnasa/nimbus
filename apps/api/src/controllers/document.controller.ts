/**
 * @module api/controllers/document
 * @description Document CRUD scoped by workspace membership. Deletes require
 * ADMIN/OWNER and also evict the in-memory Yjs (`docs`) / canvas (`canvases`)
 * entries so deleted documents cannot be resurrected by a stale socket room.
 */
import { prisma } from "@nimbus/db";
import { ServerResponse } from "@nimbus/types";
import { canvases } from "../socket/canvas";
import { docs } from "../socket/document";

/**
 * Creates a CANVAS (empty `canvasData`) or MARKDOWN document.
 *
 * @param title - Document title.
 * @param workspaceId - Owning workspace (caller must be a member).
 * @param userId - Acting user's ID.
 * @param type - Document kind.
 */
export const createDocument = async (
  title: string,
  workspaceId: string,
  userId: string,
  type: "CANVAS" | "MARKDOWN",
) => {
  try {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId },
      },
    });
    if (!member) return ServerResponse.forbidden("Not a member");

    let document;

    if (type == "CANVAS") {
      document = await prisma.document.create({
        data: { title, workspaceId, canvasData: [], type },
      });
    } else {
      document = await prisma.document.create({
        data: { title, workspaceId, type },
      });
    }

    return ServerResponse.ok(document);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Lists a workspace's documents, most-recently-updated first.
 *
 * @param workspaceId - Workspace to list.
 * @param userId - Acting user's ID (must be a member).
 */
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

/**
 * Fetches one document after verifying workspace membership via the
 * document's parent workspace.
 */
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

/**
 * Deletes a document (ADMIN/OWNER only) and evicts its live socket state.
 *
 * NOTE: the `canvases`/`docs` evictions prevent a deleted doc from being
 * re-persisted by the debounced socket save after deletion.
 */
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
    canvases.delete(docId);
    docs.delete(docId);
    return ServerResponse.ok("Document deleted");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};
