/**
 * @module ui/components/Input
 * @description Styled single-line text input with panel background, hairline border,
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
      className={`bg-(--panel) h-11 rounded-[11px] px-4 py-3 text-sm border border-(--line-3) focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-(--violet)/20 focus-visible:border-(--violet) transition-all duration-200 placeholder:text-(--text-dim) ${className}`}
    />
  );
}
