/**
 * @module web/api/message
 * @description Server-side chat history fetch helper. Forwards cookies with
 * `cache: "no-store"` and returns the API's `responseObject` verbatim.
 */
import { Message } from "@nimbus/types";
import { headers } from "next/headers";

/**
 * Fetches the latest workspace messages (chronological, oldest-first).
 *
 * @param id - Workspace id.
 * @throws When the API responds non-OK.
 */
export async function getMessages(id: string): Promise<Message[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/messages/${id}`,
    {
      headers: { cookie: (await headers()).get("cookie") ?? "" },
      cache: "no-store",
    },
  );

  if (!res.ok) throw new Error("Failed to fetch messages");

  const data = await res.json();

  return data.responseObject;
}
