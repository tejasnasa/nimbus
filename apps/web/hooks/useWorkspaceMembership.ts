/**
 * @module web/hooks/useWorkspaceMembership
 * @description The viewer's own membership: leaving a workspace (routes to
 * `/home`), and, for the owner, handing ownership to another member (refreshes
 * the route so the new roles show). Loading is keyed by action; failures and
 * confirmations are returned as `error` / `notice` for the consumer to render
 * inline.
 *
 * @important The owner cannot leave: the API refuses until ownership has been
 *            transferred, after which the previous owner is an admin and may
 *            leave like anyone else.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Reads the envelope's message from a failed response, if it has one. */
async function messageOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message || fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param workspaceId - The workspace cuid.
 * @param userId - The signed-in user, who is the one leaving.
 */
export function useWorkspaceMembership(workspaceId: string, userId?: string) {
  const router = useRouter();
  const [loading, setLoading] = useState<"leave" | "transfer" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const request = async (path: string, method: string, memberId: string) => {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/${path}/${workspaceId}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ memberId }),
      },
    );
    return res;
  };

  const handleLeave = async () => {
    if (!userId) return;
    setLoading("leave");
    setError(null);
    setNotice(null);
    try {
      const res = await request("leave", "DELETE", userId);
      if (!res.ok) {
        setError(await messageOf(res, "Could not leave the workspace."));
        return;
      }
      router.push("/home");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  const handleTransfer = async (memberId: string) => {
    setLoading("transfer");
    setError(null);
    setNotice(null);
    try {
      const res = await request("transfer", "PUT", memberId);
      if (!res.ok) {
        setError(await messageOf(res, "Could not transfer ownership."));
        return;
      }
      setNotice("Ownership transferred. You are now an admin.");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  return { handleLeave, handleTransfer, loading, error, notice };
}
