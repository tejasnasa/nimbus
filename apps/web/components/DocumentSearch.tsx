/**
 * @module web/components/DocumentSearch
 * @description The search box at the top of the settings Documents tab and its
 * results: title, type and an excerpt with the matched words highlighted.
 * Choosing a result opens the document in the editor through
 * `useOpenDocument` and closes the settings dialog, the same way a meeting's
 * notes open from the Meetings tab.
 *
 * @important Excerpts are rendered through `MarkedSnippet`, as text and
 *            `<mark>` elements only; document text never becomes markup.
 */
"use client";

import Markdown from "@nimbus/ui/icons/Markdown";
import Flow from "@nimbus/ui/icons/Flow";
import { useState, type FormEvent } from "react";
import { useDocumentSearch } from "../hooks/useDocumentSearch";
import { useOpenDocument } from "../hooks/useOpenDocument";
import MarkedSnippet from "./MarkedSnippet";
import { useOptionalWorkspaceSettings } from "./WorkspaceSettingsContext";

/** @param props.workspaceId - The workspace cuid to search. */
export default function DocumentSearch({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { state, search, clear } = useDocumentSearch(workspaceId);
  const opener = useOpenDocument();
  const settings = useOptionalWorkspaceSettings();
  const [text, setText] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void search(text);
  };

  const open = async (documentId: string) => {
    if (await opener.open(documentId)) settings?.close();
  };

  return (
    <div className="mb-4 space-y-3" data-testid="document-search">
      <form onSubmit={submit} role="search" className="flex items-center gap-2">
        <input
          type="search"
          aria-label="Search documents"
          placeholder="Search documents"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value.trim()) clear();
          }}
          className="min-w-0 flex-1 rounded-xl border border-(--border) bg-(--background) px-3 py-2 text-sm outline-none focus:border-(--primary)"
        />
        <button
          type="submit"
          className="rounded-xl border border-(--border) px-3 py-2 text-sm hover:bg-(--muted) hover:cursor-pointer"
        >
          Search
        </button>
        {state.kind !== "idle" && (
          <button
            type="button"
            onClick={() => {
              setText("");
              clear();
            }}
            className="rounded-xl px-3 py-2 text-sm text-(--muted-foreground) hover:cursor-pointer hover:underline"
          >
            Clear
          </button>
        )}
      </form>

      {state.kind === "loading" && (
        <p role="status" className="text-xs text-(--muted-foreground)">
          Searching…
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-xs text-(--destructive)">
          {state.message}
        </p>
      )}
      {opener.error && (
        <p role="alert" className="text-xs text-(--destructive)">
          {opener.error}
        </p>
      )}
      {state.kind === "done" &&
        (state.hits.length === 0 ? (
          <p role="status" className="text-xs text-(--muted-foreground)">
            No documents match “{state.query}”.
          </p>
        ) : (
          <ul aria-label="Search results" className="space-y-1">
            {state.hits.map((hit) => (
              <li key={hit.documentId}>
                <button
                  type="button"
                  data-testid="document-hit"
                  onClick={() => void open(hit.documentId)}
                  disabled={opener.opening !== null}
                  className="flex w-full items-start gap-3 rounded-xl p-3 text-left hover:bg-(--muted)/30 hover:cursor-pointer"
                >
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--muted)/50">
                    {hit.type === "MARKDOWN" ? (
                      <Markdown className="size-4 text-(--muted-foreground)" />
                    ) : (
                      <Flow className="size-4 text-(--muted-foreground)" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {hit.title}
                      <span className="ml-2 text-xs font-normal text-(--muted-foreground)">
                        {hit.type}
                      </span>
                    </div>
                    <MarkedSnippet snippet={hit.snippet} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
