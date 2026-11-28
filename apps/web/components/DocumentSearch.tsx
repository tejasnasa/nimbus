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

import LogoSpinner from "@nimbus/ui/LogoSpinner";
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
    <div className="space-y-3" data-testid="document-search">
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
          className="min-h-10.5 min-w-0 flex-1 rounded-[11px] border border-(--line-3) bg-(--panel) px-3 text-sm text-(--foreground) outline-none transition-shadow placeholder:text-(--text-dim) focus:border-(--violet) focus:ring-[3px] focus:ring-(--violet)/20"
        />
        <button
          type="submit"
          className="min-h-10.5 rounded-[11px] border border-(--line-3) px-3.5 text-sm transition-colors hover:bg-(--surface-3) hover:cursor-pointer"
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
            className="rounded-[11px] px-3 text-sm text-(--muted-foreground) hover:cursor-pointer hover:underline"
          >
            Clear
          </button>
        )}
      </form>

      {state.kind === "loading" && (
        <LogoSpinner label="Searching…" size={20} centered />
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
                  className="flex w-full items-start gap-3 rounded-[13px] border border-(--line-1) bg-(--panel) p-3 text-left transition-colors hover:bg-(--grid-line) hover:cursor-pointer"
                >
                  <div
                    className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-(--surface-4) font-mono text-[9px] font-bold ${
                      hit.type === "MARKDOWN"
                        ? "text-(--violet)"
                        : "text-(--lime)"
                    }`}
                  >
                    {hit.type === "MARKDOWN" ? "DOC" : "BRD"}
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
