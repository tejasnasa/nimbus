/**
 * @module ui/components/Textarea
 * @description Multi-line input matching the Input component's panel/violet focus-ring
 * styling. The height is fixed per `size` and the field is not resizable, so
 * `size` decides how much of a long answer is visible while it is being
 * written.
 */
import { TextareaHTMLAttributes } from "react";

/** Fixed height per size. */
const heights = {
  sm: "h-32",
  lg: "h-56",
} as const;

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Writing surface height. Defaults to `"sm"`. */
  size?: keyof typeof heights;
};

/**
 * Multi-line text input.
 *
 * Pass-through wrapper around `<textarea>` — all native props are forwarded
 * unchanged; resizing is disabled via `resize-none`.
 *
 * The height is a prop rather than something a caller overrides with
 * `className`: both sizes are the same utility, so which one won would come
 * down to rule order in the generated stylesheet rather than to the order they
 * appear in the attribute.
 *
 * @param props.size - Height preset; `"lg"` suits long-form input.
 */
export default function Textarea({ className, size = "sm", ...props }: Props) {
  return (
    <textarea
      {...props}
      className={`bg-(--panel) ${heights[size]} rounded-[11px] px-4 py-3 text-sm border border-(--line-3) focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-(--violet)/20 focus-visible:border-(--violet) transition-all duration-200 resize-none placeholder:text-(--text-dim) ${className ?? ""}`}
    ></textarea>
  );
}
