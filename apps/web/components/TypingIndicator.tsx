/**
 * @module web/components/TypingIndicator
 * @description Pure presentational typing status line: three animated dots
 * plus "Ana is typing…", "Ana and Ben are typing…", or "3 people are
 * typing…" once the count exceeds two. Reserves a fixed height so the
 * composer does not jump as the line appears and disappears.
 *
 * The line is a polite live region (`role="status"`), so a screen reader
 * announces who is typing without interrupting. Nimbus is passed in as a
 * name like any other typer.
 *
 * @important The line is always rendered — when nobody is typing it renders
 *            an empty placeholder the same height, which is what keeps the
 *            composer from shifting. The dots are part of the *message*, not
 *            the placeholder: rendering them unconditionally leaves a
 *            permanent "someone is typing" animation on screen.
 */
"use client";

/**
 * @param props.names - Names of currently-typing peers (order is whatever the
 *                      hook returns; the component renders it as-is).
 */
export default function TypingIndicator({ names }: { names: string[] }) {
  const count = names.length;
  const label =
    count === 0
      ? ""
      : count === 1
        ? `${names[0]} is typing…`
        : count === 2
          ? `${names[0]} and ${names[1]} are typing…`
          : `${count} people are typing…`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="h-5 px-1 flex items-center gap-2 text-xs text-(--muted-foreground)"
    >
      {count > 0 && (
        <div className="flex items-end gap-0.75" aria-hidden="true">
          <span className="ws-dot" />
          <span className="ws-dot" style={{ animationDelay: "150ms" }} />
          <span className="ws-dot" style={{ animationDelay: "300ms" }} />
        </div>
      )}
      <span>{label}</span>
    </div>
  );
}
