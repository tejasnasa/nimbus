/**
 * @module web/components/MarkedSnippet
 * @description A search excerpt shown as text with the matched words
 * highlighted.
 *
 * @important The excerpt is raw document or transcript text with matches
 *            wrapped in `<mark>` and `</mark>` by the API. It is split by
 *            `splitSnippet` and rendered as React text and `<mark>` elements,
 *            never as HTML, so nothing in a document can become markup.
 */
"use client";

import { splitSnippet } from "../lib/meetingFormat";

/** @param props.snippet - Text with matches wrapped in `<mark>` tags. */
export default function MarkedSnippet({ snippet }: { snippet: string }) {
  return (
    <p className="text-xs">
      {splitSnippet(snippet).map((part, index) =>
        part.marked ? (
          <mark
            key={index}
            className="rounded bg-(--primary)/25 px-0.5 text-inherit"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}
