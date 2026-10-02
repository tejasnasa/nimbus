/**
 * @module web/hooks/useWorkspaceMembers
 * @description Member management: role updates and removals with per-member
 * loading state. Refreshes the route on success; RBAC errors surface via alert.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * @param workspaceId - Workspace the members belong to.
 * @returns `handleUpdateRole`, `handleRemoveMember`, and the in-flight `loading` member id.
 */
export function useWorkspaceMembers(workspaceId: string) {
  const router = useRouter();
  // More than one member can have a request in flight at once, so in-flight ids
  // are tracked as a list and the hook reports the most recent. A single value
  // would let the first response to land clear the spinner for a request that
  // is still running.
  const [inFlight, setInFlight] = useState<string[]>([]);
  const loading = inFlight[inFlight.length - 1] ?? null;

  const markLoading = (memberId: string) =>
    setInFlight((prev) => [...prev, memberId]);

  const clearLoading = (memberId: string) =>
    setInFlight((prev) => {
      const index = prev.indexOf(memberId);
      if (index === -1) return prev;
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });

  const handleUpdateRole = async (memberId: string, role: string) => {
    markLoading(memberId);
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
      clearLoading(memberId);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    markLoading(memberId);
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
      clearLoading(memberId);
    }
  };

  return {
    handleUpdateRole,
    handleRemoveMember,
    loading,
  };
}
