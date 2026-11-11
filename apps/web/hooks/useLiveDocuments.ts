/**
 * @module web/hooks/useLiveDocuments
 * @description The workspace's document list, kept current from the server's
 * `document:created`, `document:renamed` and `document:deleted` events, so the
 * Documents tab shows other members' changes without a reload.
 *
 * @important Every update is idempotent by document id. `document:created` also
 *            arrives for documents the client learns about another way (an AI
 *            generation, meeting notes, or one this user just created and
 *            added), and an event may be delivered after the change it
 *            describes was applied locally.
 */
import type { DocumentSummaryDTO } from "@nimbus/types";
import { useCallback, useEffect, useState } from "react";
import type { ClientDocument } from "../api/document";
import { socket } from "../lib/socket";

/** The editor-shaped document an announcement describes. */
export function toClientDocument(summary: DocumentSummaryDTO): ClientDocument {
  return {
    id: summary.id,
    label: summary.title,
    type: summary.type,
    elements: [],
    yjsState: null,
  };
}

/**
 * @param initial - The list the page was rendered with.
 * @returns The live list plus local updates for changes this client made.
 */
export function useLiveDocuments(initial: ClientDocument[]) {
  const [documents, setDocuments] = useState<ClientDocument[]>(initial);

  const add = useCallback((doc: ClientDocument) => {
    setDocuments((prev) =>
      prev.some((existing) => existing.id === doc.id) ? prev : [...prev, doc],
    );
  }, []);

  const rename = useCallback((documentId: string, title: string) => {
    setDocuments((prev) =>
      prev.some((doc) => doc.id === documentId && doc.label !== title)
        ? prev.map((doc) =>
            doc.id === documentId ? { ...doc, label: title } : doc,
          )
        : prev,
    );
  }, []);

  const remove = useCallback((documentId: string) => {
    setDocuments((prev) =>
      prev.some((doc) => doc.id === documentId)
        ? prev.filter((doc) => doc.id !== documentId)
        : prev,
    );
  }, []);

  useEffect(() => {
    const onCreated = (data: { document: DocumentSummaryDTO }) =>
      add(toClientDocument(data.document));
    const onRenamed = (data: { documentId: string; title: string }) =>
      rename(data.documentId, data.title);
    const onDeleted = (data: { documentId: string }) => remove(data.documentId);

    socket.on("document:created", onCreated);
    socket.on("document:renamed", onRenamed);
    socket.on("document:deleted", onDeleted);
    return () => {
      socket.off("document:created", onCreated);
      socket.off("document:renamed", onRenamed);
      socket.off("document:deleted", onDeleted);
    };
  }, [add, rename, remove]);

  return { documents, add, rename, remove };
}
