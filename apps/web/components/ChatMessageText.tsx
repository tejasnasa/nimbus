/**
 * @module web/components/ChatMessageText
 * @description The text of a chat message with one piece of markup understood:
 * a document link written `[label](nimbus-doc:<documentId>)`, which NimbusBot
 * posts when meeting notes are ready. It renders as a button that opens that
 * document in the editor. Everything else, including anything that looks like
 * HTML or other markdown, stays plain text.
 *
 * @important Text is only ever rendered as React text nodes, never as HTML, and
 *            the id inside a link is limited to id-safe characters, so a message
 *            cannot smuggle markup or a different link scheme through this
 *            component. Opening a document is still authorised by the API.
 */
"use client";

import type { ReactNode } from "react";

/** A `[label](nimbus-doc:id)` link: a one-line label and an id-safe id. */
const DOC_LINK = /\[([^\]\n]{1,200})\]\(nimbus-doc:([A-Za-z0-9_-]{1,64})\)/g;

/**
 * Whether a message holds at least one document link.
 *
 * @param text - The message text.
 */
export function hasDocLink(text: string): boolean {
  return new RegExp(DOC_LINK.source).test(text);
}

/**
 * @param props.text - The message text.
 * @param props.onOpenDocument - Opens the linked document.
 */
export default function ChatMessageText({
  text,
  onOpenDocument,
}: {
  text: string;
  onOpenDocument: (documentId: string) => void;
}) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(DOC_LINK)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const [, label, documentId] = match;
    nodes.push(
      <button
        key={`${start}-${documentId}`}
        type="button"
        data-testid="chat-doc-link"
        onClick={() => onOpenDocument(documentId!)}
        className="font-medium text-(--primary) underline underline-offset-2 hover:cursor-pointer"
      >
        {label}
      </button>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}
