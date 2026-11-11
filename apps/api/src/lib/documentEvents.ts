/**
 * @module api/lib/documentEvents
 * @description Announcing document lifecycle changes to a workspace room:
 * `document:created`, `document:renamed` and `document:deleted`. Every place
 * that creates, renames or deletes a document row broadcasts through here, so
 * open tabs and the Documents list stay current without a reload.
 *
 * @important Announce only after the change is committed, and never fail the
 *            request that made it: broadcasting is best-effort and these
 *            helpers swallow synchronous emit errors. A caller without a
 *            Socket.IO server (a script, a unit test) passes `undefined`.
 *
 * @important `document:created` is also sent for documents that clients learn
 *            about another way (`doc:ai:complete`, `meeting:notes-ready`).
 *            Clients dedupe by id; do not suppress the event here.
 */
import type { DocumentSummaryDTO } from "@nimbus/types";
import type { Server } from "socket.io";

/** The slice of Socket.IO that document announcements use. */
export type DocumentBroadcaster = Pick<Server, "to">;

/** The fields of a document row an announcement is built from. */
type DocumentRow = {
  id: string;
  title: string;
  type: "CANVAS" | "MARKDOWN";
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Shapes a document row as the body-less summary clients receive.
 *
 * @param document - The stored row.
 */
export function toDocumentSummary(document: DocumentRow): DocumentSummaryDTO {
  return {
    id: document.id,
    title: document.title,
    type: document.type,
    workspaceId: document.workspaceId,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

/** Runs a broadcast, keeping a failure from reaching the caller. */
function safely(broadcast: () => void): void {
  try {
    broadcast();
  } catch (error) {
    console.error(
      "[document] broadcast failed:",
      error instanceof Error ? error.name : "unknown error",
    );
  }
}

/**
 * Tells the workspace a document exists.
 *
 * @param io - Broadcaster, or undefined to do nothing.
 * @param document - The committed row.
 */
export function announceDocumentCreated(
  io: DocumentBroadcaster | undefined,
  document: DocumentRow,
): void {
  if (!io) return;
  safely(() =>
    io
      .to(document.workspaceId)
      .emit("document:created", { document: toDocumentSummary(document) }),
  );
}

/**
 * Tells the workspace a document was renamed.
 *
 * @param io - Broadcaster, or undefined to do nothing.
 * @param workspaceId - The document's workspace.
 * @param documentId - The renamed document.
 * @param title - Its new title.
 */
export function announceDocumentRenamed(
  io: DocumentBroadcaster | undefined,
  workspaceId: string,
  documentId: string,
  title: string,
): void {
  if (!io) return;
  safely(() =>
    io.to(workspaceId).emit("document:renamed", { documentId, title }),
  );
}

/**
 * Tells the workspace a document is gone.
 *
 * @param io - Broadcaster, or undefined to do nothing.
 * @param workspaceId - The document's workspace.
 * @param documentId - The deleted document.
 * @param deletedById - Who deleted it, so their own open tabs simply close.
 */
export function announceDocumentDeleted(
  io: DocumentBroadcaster | undefined,
  workspaceId: string,
  documentId: string,
  deletedById: string,
): void {
  if (!io) return;
  safely(() =>
    io.to(workspaceId).emit("document:deleted", { documentId, deletedById }),
  );
}
