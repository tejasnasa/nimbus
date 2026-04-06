import { useState } from "react";

export function useWorkspaceDocuments() {
  const [loading, setLoading] = useState<string | null>(null);

  const handleDeleteDocument = async (docId: string) => {
    setLoading(docId);
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
        const error = await res.json();
        throw new Error(
          error.message ?? "Failed to delete document",
        );
      }

      window.location.reload();
    } catch (error) {
      alert((error as { message?: string }).message ?? "Something went wrong.");
    } finally {
      setLoading(null);
    }
  };

  return {
    handleDeleteDocument,
    loading,
  };
}
