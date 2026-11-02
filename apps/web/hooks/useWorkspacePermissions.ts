/**
 * @module web/hooks/useWorkspacePermissions
 * @description Workspace danger-zone actions: invite-code regeneration,
 * workspace deletion (routes to `/home`), and clipboard copy. Loading is
 * keyed by action (`regenerate` | `delete`). Failures and confirmations are
 * returned as `error` / `notice` state for the consumer to render inline.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * @param workspaceId - Target workspace cuid.
 */
export function useWorkspacePermissions(workspaceId: string) {
  const router = useRouter();
  const [loading, setLoading] = useState<"regenerate" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleRegenerateInviteCode = async () => {
    setLoading("regenerate");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/regenerate-invite/${workspaceId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        },
      );

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? "Failed to regenerate invite code");
      }

      // The code the UI displays and copies is server-rendered, so the route
      // has to be refreshed or it keeps showing the invalidated code.
      setNotice("Invite code regenerated.");
      router.refresh();
    } catch (err) {
      setError((err as { message?: string }).message ?? "Something went wrong.");
    } finally {
      setLoading(null);
    }
  };

  const handleDeleteWorkspace = async () => {
    setLoading("delete");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/delete/${workspaceId}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        },
      );

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? "Failed to delete workspace");
      }

      router.push("/home");
    } catch (err) {
      setError((err as { message?: string }).message ?? "Something went wrong.");
    } finally {
      setLoading(null);
    }
  };

  const handleCopyInviteCode = (code: string) => {
    setError(null);
    navigator.clipboard.writeText(code).then(
      () => setNotice("Invite code copied to clipboard."),
      () => setError("Could not copy the invite code."),
    );
  };

  return {
    handleRegenerateInviteCode,
    handleDeleteWorkspace,
    handleCopyInviteCode,
    loading,
    error,
    notice,
  };
}
