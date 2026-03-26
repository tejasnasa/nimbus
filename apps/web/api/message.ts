import { Message } from "@nimbus/types";
import { headers } from "next/headers";

export async function getMessages(id: string): Promise<Message[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/messages/${id}`,
    {
      headers: { cookie: (await headers()).get("cookie") ?? "" },
      cache: "no-store",
    },
  );

  console.log(res);
  if (!res.ok) throw new Error("Failed to fetch messages");

  const data = await res.json();
  console.log(data.responseObject);

  return data.responseObject;
}
