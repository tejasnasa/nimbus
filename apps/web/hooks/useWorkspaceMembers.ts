import { useRouter } from "next/navigation";
import { useState } from "react";

export function useWorkspaceMembers(workspaceId: string) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handleUpdateRole = async (memberId: string, role: string) => {
    setLoading(memberId);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/role/${workspaceId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ memberId, role }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to update role");
      }

      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    setLoading(memberId);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/leave/${workspaceId}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ memberId }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to remove member");
      }

      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  return {
    handleUpdateRole,
    handleRemoveMember,
    loading,
  };
}
