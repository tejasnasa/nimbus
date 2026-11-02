/**
 * @module web/hooks/useWorkspaceDocuments
 * @description Document deletion with per-doc loading state. Refreshes the
 * route on success so tab/document lists re-render from the server, and returns
 * failures as `error` state for the consumer to render inline.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Returns `handleDeleteDocument(docId)`, the in-flight `loading` id, and the
 * `error` / `notice` of the latest attempt.
 */
export function useWorkspaceDocuments() {
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
      router.refresh();
    } catch (err) {
      setError((err as { message?: string }).message ?? "Something went wrong.");
    } finally {
      setLoading(null);
    }
  };

  return {
    handleDeleteDocument,
    loading,
    error,
    notice,
  };
}
