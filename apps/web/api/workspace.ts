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
