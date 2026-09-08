/**
 * @module ui/components/Input
 * @description Styled single-line text input with muted background, border,
 * and focus-ring treatment shared by all auth and workspace forms.
 */
import { InputHTMLAttributes } from "react";

/**
 * Single-line text input.
 *
 * Pass-through wrapper around `<input>` — all native props (type, value,
 * onChange, placeholder, …) are forwarded unchanged.
 */
export default function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`bg-(--muted)/50 h-11 rounded-xl px-4 py-3 text-sm border border-(--border) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:border-(--primary)/30 transition-all duration-200 placeholder:text-(--muted-foreground)/50 ${className}`}
    />
  );
}
