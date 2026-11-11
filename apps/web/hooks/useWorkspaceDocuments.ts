/**
 * @module web/hooks/useWorkspaceDocuments
 * @description Document deletion, renaming and download with per-doc loading
 * state. Deleting refreshes the route so tab/document lists re-render from the
 * server; renaming and downloading report through the same inline `error` /
 * `notice` state, which the consumer renders.
 */
import { DOCUMENT_TITLE_MAX, documentRenameSchema } from "@nimbus/types";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { renameDocument } from "../lib/documentApi";
import { downloadDocument } from "../lib/documentDownload";

/**
 * Checks a title the way the server will, so a bad one is refused before a
 * request is made.
 *
 * @param raw - The title as typed.
 * @returns A message to show, or null when the title is acceptable.
 */
export function titleProblem(raw: string): string | null {
  if (!raw.trim()) return "Title cannot be empty.";
  if (raw.trim().length > DOCUMENT_TITLE_MAX) {
    return `Title must be at most ${DOCUMENT_TITLE_MAX} characters.`;
  }
  return documentRenameSchema.safeParse({ title: raw }).success
    ? null
    : "That title is not valid.";
}

/** Callbacks for changes this client made itself. */
export type WorkspaceDocumentsCallbacks = {
  /** A document was deleted here. */
  onDeleted?: (documentId: string) => void;
  /** A document was renamed here, with its stored title. */
  onRenamed?: (documentId: string, title: string) => void;
};

/** The outcome of a rename: the stored title, or a message to show inline. */
export type RenameResult =
  | { ok: true; title: string }
  | { ok: false; message: string };

/**
 * Returns `handleDeleteDocument(docId)`, `handleRenameDocument(docId, title)`,
 * `handleDownloadDocument(docId, title)`, the in-flight `loading` id, and the
 * `error` / `notice` of the latest attempt.
 *
 * @param callbacks - Notified of changes made here, so a list can update
 *                    without waiting for the server's broadcast.
 */
export function useWorkspaceDocuments(
  callbacks: WorkspaceDocumentsCallbacks = {},
) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleDeleteDocument = async (docId: string) => {
    setLoading(docId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/document/${docId}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        },
      );

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? "Failed to delete document");
      }

      setNotice("Document deleted.");
      callbacks.onDeleted?.(docId);
      router.refresh();
    } catch (err) {
      setError(
        (err as { message?: string }).message ?? "Something went wrong.",
      );
    } finally {
      setLoading(null);
    }
  };

  const handleRenameDocument = async (
    docId: string,
    title: string,
  ): Promise<RenameResult> => {
    const problem = titleProblem(title);
    if (problem) return { ok: false, message: problem };
    setLoading(docId);
    setError(null);
    setNotice(null);
    const result = await renameDocument(docId, title.trim());
    setLoading(null);
    if (!result.ok) return { ok: false, message: result.message };
    callbacks.onRenamed?.(docId, result.data.title);
    return { ok: true, title: result.data.title };
  };

  const handleDownloadDocument = async (docId: string, title: string) => {
    setLoading(docId);
    setError(null);
    setNotice(null);
    const result = await downloadDocument(docId, title);
    setLoading(null);
    if (!result.ok) setError(result.message);
  };

  return {
    handleDeleteDocument,
    handleRenameDocument,
    handleDownloadDocument,
    loading,
    error,
    notice,
  };
}
