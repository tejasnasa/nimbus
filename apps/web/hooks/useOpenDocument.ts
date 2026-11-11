/**
 * @module web/hooks/useOpenDocument
 * @description Opens a document in the editor by id. The editor's tab list is
 * driven from the page's initial document list, so a document created since
 * (the notes written after a meeting) is fetched first and then handed to the
 * editor's add-tab bridge, which focuses the tab if it is already open.
 *
 * @important Failures are reported through `error`, not thrown, and `error`
 *            clears on the next attempt. The hook must be used under
 *            `DocEditorRefProvider`.
 */
"use client";

import { useCallback, useState } from "react";
import { useDocEditorRef } from "../components/DocEditorRefContext";
import { fetchDocument } from "../lib/documentApi";

export type UseOpenDocument = {
  /** Opens the document; resolves true once the editor was handed it. */
  open: (documentId: string) => Promise<boolean>;
  /** The id being fetched, or null. */
  opening: string | null;
  error: string | null;
};

/** @returns The opener and its pending and error state. */
export function useOpenDocument(): UseOpenDocument {
  const addTabRef = useDocEditorRef();
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (documentId: string) => {
      setError(null);
      setOpening(documentId);
      const doc = await fetchDocument(documentId);
      setOpening(null);
      if (!doc || !addTabRef.current) {
        setError("That document could not be opened.");
        return false;
      }
      addTabRef.current(doc);
      return true;
    },
    [addTabRef],
  );

  return { open, opening, error };
}
