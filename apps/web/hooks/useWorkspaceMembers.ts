/**
 * @module web/hooks/useWorkspaceMembers
 * @description Member management: role updates and removals with per-member
 * loading state. Refreshes the route on success; RBAC errors are returned as
 * `error` state for the consumer to render inline.
 *
 * @important The per-row in-flight tracking (`loading`) and the message state
 *            (`error`, `notice`) are deliberately separate: several rows can be
 *            in flight at once, while the messages describe only the most
 *            recent attempt.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * @param workspaceId - Workspace the members belong to.
 * @returns `handleUpdateRole`, `handleRemoveMember`, the in-flight `loading`
 *          member id, and the `error` / `notice` of the latest attempt.
 */
export function useWorkspaceMembers(workspaceId: string) {
  const router = useRouter();
  // More than one member can have a request in flight at once, so in-flight ids
  // are tracked as a list and the hook reports the most recent. A single value
  // would let the first response to land clear the spinner for a request that
  // is still running.
  const [inFlight, setInFlight] = useState<string[]>([]);
  const loading = inFlight[inFlight.length - 1] ?? null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    setError(null);
    setNotice(null);
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

      setNotice("Role updated.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      clearLoading(memberId);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    markLoading(memberId);
    setError(null);
    setNotice(null);
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

      setNotice("Member removed.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      clearLoading(memberId);
    }
  };

  return {
    handleUpdateRole,
    handleRemoveMember,
    loading,
    error,
    notice,
  };
}
