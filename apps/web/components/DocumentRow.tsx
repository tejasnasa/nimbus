/**
 * @module web/components/DocumentRow
 * @description One row of the settings Documents list: the document's icon,
 * title and type, with a pen button that turns the title into an inline input,
 * a download button, and a slot for the delete control.
 *
 * Editing: Enter or leaving the field saves, Escape cancels, an unchanged title
 * is a no-op, and an empty or over-long title is refused with a message under
 * the field while the field stays open.
 *
 * @important Escape must not save. Removing the input from the page blurs it,
 *            and a blur saves, so cancelling is recorded before the field is
 *            closed and the blur that follows is ignored. The same guard stops
 *            Enter from saving twice (once for the key, once for the blur).
 */
"use client";

import Download from "@nimbus/ui/icons/Download";
import Edit from "@nimbus/ui/icons/Edit";
import Flow from "@nimbus/ui/icons/Flow";
import Markdown from "@nimbus/ui/icons/Markdown";
import { useRef, useState, type ReactNode } from "react";
import type { ClientDocument } from "../api/document";
import {
  titleProblem,
  type RenameResult,
} from "../hooks/useWorkspaceDocuments";

const ACTION =
  "p-1.5 rounded-lg hover:bg-(--muted) transition-colors hover:cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40";

/**
 * @param props.document - The document shown.
 * @param props.busy - A request for this document is in flight.
 * @param props.onRename - Saves a new title; resolves with the outcome.
 * @param props.onDownload - Downloads the document.
 * @param props.children - The delete control.
 */
export default function DocumentRow({
  document: doc,
  busy,
  onRename,
  onDownload,
  children,
}: {
  document: ClientDocument;
  busy: boolean;
  onRename: (title: string) => Promise<RenameResult>;
  onDownload: () => void;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const settled = useRef(false);

  const begin = () => {
    settled.current = false;
    setProblem(null);
    setDraft(doc.label);
  };

  const cancel = () => {
    settled.current = true;
    setProblem(null);
    setDraft(null);
  };

  const commit = async () => {
    if (settled.current || draft === null) return;
    const trimmed = draft.trim();
    if (trimmed === doc.label) return cancel();
    const invalid = titleProblem(draft);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    settled.current = true;
    const result = await onRename(trimmed);
    if (result.ok) {
      setDraft(null);
      return;
    }
    settled.current = false;
    setProblem(result.message);
  };

  return (
    <div
      data-testid="document-row"
      className="flex justify-between items-center p-3 rounded-xl hover:bg-(--muted)/30 transition-colors group"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-(--muted)/50 flex items-center justify-center shrink-0">
          {doc.type === "MARKDOWN" ? (
            <Markdown className="w-5 h-5 text-(--muted-foreground)" />
          ) : (
            <Flow className="w-5 h-5 text-(--muted-foreground)" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {draft === null ? (
            <div className="truncate text-sm font-medium">{doc.label}</div>
          ) : (
            <>
              <input
                autoFocus
                aria-label={`Title of "${doc.label}"`}
                aria-invalid={problem ? true : undefined}
                value={draft}
                disabled={busy}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setProblem(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    cancel();
                  }
                }}
                onBlur={() => void commit()}
                className="w-full rounded-md border border-(--border) bg-(--background) px-2 py-1 text-sm outline-none focus:border-(--primary)"
              />
              {problem && (
                <p role="alert" className="mt-1 text-xs text-(--destructive)">
                  {problem}
                </p>
              )}
            </>
          )}
          <div className="text-xs text-(--muted-foreground)">{doc.type}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {draft === null && (
          <button
            type="button"
            aria-label={`Rename "${doc.label}"`}
            title="Rename"
            disabled={busy}
            onClick={begin}
            className={ACTION}
          >
            <Edit className="w-4 h-4 text-(--muted-foreground)" />
          </button>
        )}
        <button
          type="button"
          aria-label={`Download "${doc.label}"`}
          title={
            doc.type === "MARKDOWN" ? "Download as .md" : "Download as .png"
          }
          disabled={busy}
          onClick={onDownload}
          className={ACTION}
        >
          <Download className="w-4 h-4 text-(--muted-foreground)" />
        </button>
        {children}
      </div>
    </div>
  );
}
