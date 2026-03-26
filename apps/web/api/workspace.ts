"use server";

import { Workspace } from "@nimbus/types";
import { headers } from "next/headers";

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
  console.log(data.responseObject);

  return data.responseObject;
}

export async function getWorkspace(workspaceId: string): Promise<Workspace> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/${workspaceId}`,
    {
      headers: { cookie: (await headers()).get("cookie") ?? "" },
      cache: "no-store",
    },
  );
  console.log(res);

  if (!res.ok) throw new Error("Failed to fetch workspace");

  const data = await res.json();


  return data.responseObject;
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
