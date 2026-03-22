import { InputHTMLAttributes } from "react";

export default function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`bg-(--muted) h-10 rounded-md px-3 py-4 text-md focus-visible:outline-none focus-visible:ring-4 transition focus-visible:ring-(--ring) ${className}`}
    />
  );
}
