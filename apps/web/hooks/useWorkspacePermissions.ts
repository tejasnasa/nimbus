import { useRouter } from "next/navigation";
import { useState } from "react";

export function useWorkspacePermissions(workspaceId: string) {
  const router = useRouter();
  const [loading, setLoading] = useState<"regenerate" | "delete" | null>(null);

  const handleRegenerateInviteCode = async () => {
    setLoading("regenerate");
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
        const error = await res.json();
        throw new Error(error.message ?? "Failed to regenerate invite code");
      }
    } catch (error) {
      alert((error as { message?: string }).message ?? "Something went wrong.");
    } finally {
      setLoading(null);
    }
  };

  const handleDeleteWorkspace = async () => {
    setLoading("delete");
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
        const error = await res.json();
        throw new Error(error.message ?? "Failed to delete workspace");
      }

      router.push("/home");
    } catch (error) {
      alert((error as { message?: string }).message ?? "Something went wrong.");
    } finally {
      setLoading(null);
    }
  };

  const handleCopyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      alert("Invite code copied to clipboard!");
    });
  };

  return {
    handleRegenerateInviteCode,
    handleDeleteWorkspace,
    handleCopyInviteCode,
    loading,
  };
}
