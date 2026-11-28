/**
 * @module web/components/docs/CodeBar
 * @description The strip above a fenced code block in the docs: the language
 * label on the left and a Copy button on the right. The only client code a
 * plain code block ships.
 *
 * @important The clipboard write is best effort. It needs a secure context and
 *            can be refused, in which case the button just stays on "Copy"
 *            rather than claiming it worked.
 */
"use client";
import { useEffect, useRef, useState } from "react";

/**
 * @param props.language - The fence's language, shown as a label.
 * @param props.text - The block's plain text, which Copy puts on the clipboard.
 */
export function CodeBar({
  language,
  text,
}: {
  language: string;
  text: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="docs-code-bar">
      <span>{language}</span>
      <button type="button" onClick={copy} aria-live="polite">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
