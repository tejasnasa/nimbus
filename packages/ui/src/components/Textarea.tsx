/**
 * @module ui/components/Textarea
 * @description Fixed-height (h-32, non-resizable) multi-line input matching
 * the Input component's muted/focus-ring styling. Used for workspace
 * descriptions and other short free-text fields.
 */
import { TextareaHTMLAttributes } from "react";

/**
 * Multi-line text input.
 *
 * Pass-through wrapper around `<textarea>` — all native props are forwarded
 * unchanged; resizing is disabled via `resize-none`.
 */
export default function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`bg-(--muted)/50 h-32 rounded-xl px-4 py-3 text-sm border border-(--border) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:border-(--primary)/30 transition-all duration-200 resize-none placeholder:text-(--muted-foreground)/50 ${className}`}
    ></textarea>
  );
}
