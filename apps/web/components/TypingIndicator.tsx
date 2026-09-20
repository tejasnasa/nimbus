/**
 * @module web/components/TypingIndicator
 * @description Pure presentational typing status line: three animated dots
 * plus "Ana is typing…", "Ana and Ben are typing…", or "3 people are
 * typing…" once the count exceeds two. Reserves a fixed height so the
 * composer does not jump as the line appears and disappears.
 *
 * @important The line is always rendered — when nobody is typing it renders
 *            an empty placeholder the same height, which is what keeps the
 *            composer from shifting.
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
      aria-live="polite"
      aria-atomic="true"
      className="h-5 px-2 flex items-center gap-2 text-[11px] text-(--muted-foreground)/70"
    >
      <div className="flex items-end gap-0.5" aria-hidden="true">
        <span
          className="w-1 h-1 rounded-full bg-(--muted-foreground)/60 animate-pulse"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="w-1 h-1 rounded-full bg-(--muted-foreground)/60 animate-pulse"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="w-1 h-1 rounded-full bg-(--muted-foreground)/60 animate-pulse"
          style={{ animationDelay: "300ms" }}
        />
      </div>
      <span>{label}</span>
    </div>
  );
}
