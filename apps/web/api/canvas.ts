import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { headers } from "next/headers";

export type DocumentDTO = {
  id: string;
  title: string;
  canvasData: unknown;
};

export type ClientDocument = {
  id: string;
  label: string;
  elements: readonly OrderedExcalidrawElement[];
};

export async function getDocuments(
  workspaceId: string,
): Promise<ClientDocument[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/document/workspace/${workspaceId}`,
    {
      headers: { cookie: (await headers()).get("cookie") ?? "" },
      cache: "no-store",
    },
  );

  if (!res.ok) {
    console.error("Failed to fetch documents:", res);
    throw new Error("Failed to fetch documents");
  }

  const data: DocumentDTO[] = await (await res.json()).responseObject;

  return data.map((doc) => ({
    id: doc.id,
    label: doc.title,
    elements: Array.isArray(doc.canvasData)
      ? (doc.canvasData as unknown as readonly OrderedExcalidrawElement[])
      : [],
  }));
}
