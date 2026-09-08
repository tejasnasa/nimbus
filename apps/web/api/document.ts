/**
 * @module web/api/document
 * @description Server-side document fetch helper. Forwards cookies with
 * `cache: "no-store"` and maps API `DocumentDTO`s (title/canvasData) to
 * `ClientDocument`s (label/elements) for the editor.
 */
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { headers } from "next/headers";

/** Raw API shape (`title` + untyped `canvasData`). */
export type DocumentDTO = {
  id: string;
  title: string;
  type: "CANVAS" | "MARKDOWN";
  canvasData: unknown;
  yjsState: unknown;
};

/** Editor-ready shape (`label` + typed element array). */
export type ClientDocument = {
  id: string;
  label: string;
  type: "CANVAS" | "MARKDOWN";
  elements: readonly OrderedExcalidrawElement[];
  yjsState: unknown;
};

/**
 * Lists a workspace's documents as client-ready models.
 *
 * Non-array `canvasData` normalizes to `[]` so canvas components always
 * receive an iterable.
 *
 * @param workspaceId - Owning workspace.
 */
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
    type: doc.type,
    elements: Array.isArray(doc.canvasData)
      ? (doc.canvasData as unknown as readonly OrderedExcalidrawElement[])
      : [],
    yjsState: doc.yjsState,
  }));
}
