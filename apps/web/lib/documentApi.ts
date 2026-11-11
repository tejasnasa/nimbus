/**
 * @module web/lib/documentApi
 * @description Browser-side read of a single document, used to open a document
 * the editor does not hold yet (the notes written after a meeting, a link in
 * chat). The server-side list helper in `api/document` cannot be imported by
 * client code, so the small mapping to the editor's shape is repeated here.
 *
 * Failures resolve to `null` rather than throwing; callers decide whether to
 * say anything. Renaming, exporting and searching resolve to
 * `{ ok: false, message }` instead, so the settings list can show why inline.
 */
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { DocumentExportDTO, DocumentSearchDTO } from "@nimbus/types";
import type { ClientDocument, DocumentDTO } from "../api/document";

/**
 * Reads one document the signed-in user can access.
 *
 * @param documentId - The document cuid.
 * @returns The editor-ready document, or null when it cannot be read.
 */
export async function fetchDocument(
  documentId: string,
): Promise<ClientDocument | null> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/document/${encodeURIComponent(documentId)}`,
      { credentials: "include" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { responseObject?: DocumentDTO };
    const doc = body.responseObject;
    if (!doc || typeof doc.id !== "string") return null;
    return {
      id: doc.id,
      label: doc.title,
      type: doc.type,
      elements: Array.isArray(doc.canvasData)
        ? (doc.canvasData as unknown as readonly OrderedExcalidrawElement[])
        : [],
      yjsState: doc.yjsState,
    };
  } catch {
    return null;
  }
}

/** A call that either produced `data` or a message safe to show. */
export type DocumentCallResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; status: number };

const FALLBACK = "Something went wrong. Please try again.";

async function call<T>(
  path: string,
  init?: RequestInit,
): Promise<DocumentCallResult<T>> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}${path}`, {
      credentials: "include",
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
    const body = (await res.json()) as {
      success?: boolean;
      message?: string;
      responseObject?: T;
    };
    if (
      !res.ok ||
      body.success === false ||
      body.responseObject === undefined
    ) {
      return {
        ok: false,
        message: body.message || FALLBACK,
        status: res.status,
      };
    }
    return { ok: true, data: body.responseObject };
  } catch {
    return { ok: false, message: FALLBACK, status: 0 };
  }
}

/**
 * Renames a document. Any workspace member may.
 *
 * @param documentId - The document cuid.
 * @param title - The new title; the server trims it and checks its length.
 */
export function renameDocument(documentId: string, title: string) {
  return call<{ id: string; title: string }>(
    `/api/document/${encodeURIComponent(documentId)}`,
    { method: "PATCH", body: JSON.stringify({ title }) },
  );
}

/**
 * Reads what a download needs: markdown text, or a canvas's elements.
 *
 * @param documentId - The document cuid.
 */
export function exportDocument(documentId: string) {
  return call<DocumentExportDTO>(
    `/api/document/${encodeURIComponent(documentId)}/export`,
  );
}

/**
 * Keyword search across a workspace's documents.
 *
 * @param workspaceId - The workspace cuid.
 * @param query - Search text in web-search syntax.
 */
export function searchDocuments(workspaceId: string, query: string) {
  const params = new URLSearchParams({ workspaceId, q: query });
  return call<DocumentSearchDTO>(`/api/document/search?${params.toString()}`);
}
