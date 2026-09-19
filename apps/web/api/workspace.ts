/**
 * @module web/api/workspace
 * @description Server-side workspace fetch helpers. Forward the request
 * cookies to the API (session auth) with `cache: "no-store"`, and strip the
 * NimbusBot pseudo-member (`NEXT_PUBLIC_BOT_USERID`) so it never renders as
 * a human collaborator.
 */
"use server";

import { Member, Workspace } from "@nimbus/types";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

/**
 * Lists the caller's workspaces (bot member filtered out).
 *
 * @returns Workspaces with human members only.
 * @throws When the API responds non-OK.
 */
export async function getWorkspaces(): Promise<Workspace[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace`,
    {
      headers: { cookie: (await headers()).get("cookie") ?? "" },
      cache: "no-store",
    },
  );

  if (!res.ok) throw new Error("Failed to fetch workspaces");

  const data = await res.json();

  const workspaces = data.responseObject.map((workspace: Workspace) => {
    const members = workspace.members.filter(
      (member) => member.id !== process.env.NEXT_PUBLIC_BOT_USERID,
    );
    return { ...workspace, members };
  });

  return workspaces;
}

/**
 * Fetches one workspace by slug id (bot member filtered out).
 *
 * @param workspaceId - URL slug id.
 * @returns Workspace detail; triggers the 404 page on non-OK.
 */
export async function getWorkspace(workspaceId: string): Promise<Workspace> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/${workspaceId}`,
    {
      headers: { cookie: (await headers()).get("cookie") ?? "" },
      cache: "no-store",
    },
  );

  if (!res.ok) {
    notFound();
  }

  const workspace = (await res.json()).responseObject;

  const members = workspace.members.filter(
    (member: Member) => member.id !== process.env.NEXT_PUBLIC_BOT_USERID,
  );

  return { ...workspace, members };
}

/**
 * Deletes a workspace (OWNER-only server-side).
 *
 * @param workspaceId - Workspace cuid.
 * @throws When the API responds non-OK.
 */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/delete/${workspaceId}`,
    {
      method: "DELETE",
      headers: { cookie: (await headers()).get("cookie") ?? "" },
    },
  );

  if (!res.ok) throw new Error("Failed to delete workspace");

  return;
}
