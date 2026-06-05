"use server";

import { Member, Workspace } from "@nimbus/types";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

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
      (member) => member.id !== process.env.NEXT_PUBLIC_BOTUSER_ID,
    );
    return { ...workspace, members };
  });

  return workspaces;
}

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
    (member: Member) => member.id !== process.env.NEXT_PUBLIC_BOTUSER_ID,
  );

  return { ...workspace, members };
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/delete/${workspaceId}`,
    {
      method: "DELETE",
      headers: { cookie: (await headers()).get("cookie") ?? "" },
    },
  );
  console.log("Delete response:", res);

  if (!res.ok) throw new Error("Failed to delete workspace");

  return;
}
