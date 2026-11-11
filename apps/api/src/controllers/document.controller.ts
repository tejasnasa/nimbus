/**
 * @module api/controllers/document
 * @description Document CRUD scoped by workspace membership, plus rename,
 * export and keyword search. Deletes require ADMIN/OWNER and also evict the
 * in-memory Yjs / canvas entries — including any pending debounced save — so a
 * deleted document cannot be resurrected by a stale socket room or a timer that
 * outlives the row. Create, rename and delete are announced to the workspace
 * room (`document:created`, `document:renamed`, `document:deleted`).
 *
 * @important Rename, export and search answer a non-member with 404, exactly as
 *            for a document or workspace that does not exist, so they cannot be
 *            used to probe for ids.
 *
 * @important Export reads the persisted state. A markdown document that is
 *            being edited right now is up to five seconds behind (the debounce),
 *            so the export flushes the live document first.
 */
import { prisma } from "@nimbus/db";
import {
  documentSearchQuerySchema,
  ServerResponse,
  type DocumentExportDTO,
  type DocumentSearchDTO,
} from "@nimbus/types";
import {
  announceDocumentCreated,
  announceDocumentDeleted,
  announceDocumentRenamed,
  type DocumentBroadcaster,
} from "../lib/documentEvents";
import { searchDocuments } from "../lib/documentSearch";
import { yjsStateToMarkdown } from "../lib/documentText";
import { evictCanvas, flushCanvas } from "../socket/canvas";
import { evictDocument, flushDocument } from "../socket/document";

/**
 * Creates a CANVAS (empty `canvasData`) or MARKDOWN document.
 *
 * @param title - Document title.
 * @param workspaceId - Owning workspace (must exist; caller must be a member).
 * @param userId - Acting user's ID.
 * @param type - Document kind.
 * @param io - Broadcaster for `document:created`; omitted by callers without one.
 */
export const createDocument = async (
  title: string,
  workspaceId: string,
  userId: string,
  type: "CANVAS" | "MARKDOWN",
  io?: DocumentBroadcaster,
) => {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { members: { select: { userId: true } } },
    });
    if (!workspace) return ServerResponse.notFound("Workspace not found");

    const isMember = workspace.members.some((m) => m.userId === userId);
    if (!isMember) return ServerResponse.forbidden("Not a member");

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

    announceDocumentCreated(io, document);
    return ServerResponse.created(document, "Document created");
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
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { members: { select: { userId: true } } },
    });
    if (!workspace) return ServerResponse.notFound("Workspace not found");

    const isMember = workspace.members.some((m) => m.userId === userId);
    if (!isMember) return ServerResponse.forbidden("Not a member");

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
 * NOTE: the evictions cancel the pending debounced save as well as the cached
 * state, so a deleted row is never re-persisted by a timer that was already
 * scheduled.
 *
 * @param io - Broadcaster for `document:deleted`; omitted by callers without one.
 */
export const deleteDocument = async (
  docId: string,
  userId: string,
  io?: DocumentBroadcaster,
) => {
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
    evictCanvas(docId);
    evictDocument(docId);
    announceDocumentDeleted(io, document.workspaceId, docId, userId);
    return ServerResponse.ok("Document deleted");
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Renames a document. Any workspace member may.
 *
 * @param docId - Document to rename.
 * @param userId - Acting user's ID.
 * @param title - The new title, already trimmed and validated.
 * @param io - Broadcaster for `document:renamed`; omitted by callers without one.
 */
export const renameDocument = async (
  docId: string,
  userId: string,
  title: string,
  io?: DocumentBroadcaster,
) => {
  try {
    const document = await prisma.document.findFirst({
      where: { id: docId, workspace: { members: { some: { userId } } } },
      select: { id: true, workspaceId: true, title: true },
    });
    if (!document) return ServerResponse.notFound("Document not found");

    if (document.title === title) {
      return ServerResponse.ok({ id: docId, title }, "Document renamed");
    }

    const updated = await prisma.document.update({
      where: { id: docId },
      data: { title },
      select: { id: true, title: true, workspaceId: true },
    });
    announceDocumentRenamed(io, updated.workspaceId, updated.id, updated.title);
    return ServerResponse.ok(
      { id: updated.id, title: updated.title },
      "Document renamed",
    );
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Returns a document's content for download: markdown text for a markdown
 * document, the element array for a canvas. Any workspace member may.
 *
 * @param docId - Document to export.
 * @param userId - Acting user's ID.
 */
export const exportDocument = async (docId: string, userId: string) => {
  try {
    const allowed = await prisma.document.findFirst({
      where: { id: docId, workspace: { members: { some: { userId } } } },
      select: { id: true },
    });
    if (!allowed) return ServerResponse.notFound("Document not found");

    // The live copy is up to a debounce interval ahead of the row.
    await Promise.all([flushDocument(docId), flushCanvas(docId)]);

    const document = await prisma.document.findUnique({
      where: { id: docId },
      select: {
        title: true,
        type: true,
        canvasData: true,
        yjsState: true,
        initialContent: true,
      },
    });
    if (!document) return ServerResponse.notFound("Document not found");

    const body: DocumentExportDTO =
      document.type === "MARKDOWN"
        ? {
            type: "MARKDOWN",
            title: document.title,
            // A seed the editor has not consumed yet is the document's content.
            markdown: document.yjsState
              ? yjsStateToMarkdown(document.yjsState)
              : (document.initialContent ?? ""),
          }
        : {
            type: "CANVAS",
            title: document.title,
            elements: Array.isArray(document.canvasData)
              ? document.canvasData
              : [],
          };
    return ServerResponse.ok(body);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};

/**
 * Keyword search across a workspace's documents. Any workspace member may.
 *
 * @param userId - Acting user's ID.
 * @param rawQuery - The request's query string (`workspaceId`, `q`, `limit`).
 */
export const searchWorkspaceDocuments = async (
  userId: string,
  rawQuery: unknown,
) => {
  const parsed = documentSearchQuerySchema.safeParse(rawQuery);
  if (!parsed.success) return ServerResponse.badRequest("Invalid query");
  const { workspaceId, q, limit } = parsed.data;
  try {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { userId: true },
    });
    if (!member) return ServerResponse.notFound("Workspace not found");

    const hits = await searchDocuments(workspaceId, q, { limit });
    const body: DocumentSearchDTO = { hits };
    return ServerResponse.ok(body);
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};
