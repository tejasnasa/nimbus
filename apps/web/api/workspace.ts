import { headers } from "next/headers";

export type Member = {
  avatarUrl: string;
  online: boolean;
};

export type Workspace = {
  slugId: number;
  name: string;
  description: string;
  slug: string;
  docCount: number;
  lastUpdated: string;
  members: Member[];
};

export async function getWorkspaces(): Promise<Workspace[]> {
  const res = await fetch(`${process.env.BACKEND_URL}/api/workspace`, {
    headers: { cookie: (await headers()).get("cookie") ?? "" },
    cache: "no-store",
  });
  console.log(res);

  if (!res.ok) throw new Error("Failed to fetch workspaces");

  return res.json();
}
