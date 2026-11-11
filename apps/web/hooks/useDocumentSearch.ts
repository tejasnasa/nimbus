/**
 * @module web/hooks/useDocumentSearch
 * @description Keyword search across the workspace's documents for the
 * Documents tab. A search runs when submitted, not on every keystroke, and a
 * result that lands after a newer search or a clear is discarded.
 *
 * @important Snippets in the results hold raw document text with matches
 *            wrapped in `<mark>` tags. They are data, not HTML: the view splits
 *            them with `splitSnippet` and renders text and `<mark>` elements,
 *            never markup.
 */
import type { DocumentSearchHitDTO } from "@nimbus/types";
import { useCallback, useRef, useState } from "react";
import { searchDocuments } from "../lib/documentApi";

export type DocumentSearchState =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "done"; query: string; hits: DocumentSearchHitDTO[] }
  | { kind: "error"; query: string; message: string };

/** @param workspaceId - The workspace cuid. */
export function useDocumentSearch(workspaceId: string) {
  const [state, setState] = useState<DocumentSearchState>({ kind: "idle" });
  const generation = useRef(0);

  const search = useCallback(
    async (raw: string) => {
      const query = raw.trim();
      const mine = ++generation.current;
      if (!query) {
        setState({ kind: "idle" });
        return;
      }
      setState({ kind: "loading", query });
      const result = await searchDocuments(workspaceId, query);
      if (mine !== generation.current) return;
      setState(
        result.ok
          ? { kind: "done", query, hits: result.data.hits }
          : { kind: "error", query, message: result.message },
      );
    },
    [workspaceId],
  );

  const clear = useCallback(() => {
    generation.current += 1;
    setState({ kind: "idle" });
  }, []);

  return { state, search, clear };
}
