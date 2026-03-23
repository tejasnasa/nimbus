import { TextareaHTMLAttributes } from "react";

export default function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`bg-(--muted) h-40 w-96 rounded-md px-3 py-4 text-md focus-visible:outline-none focus-visible:ring-4 transition focus-visible:ring-(--ring) resize-none ${className}`}
    ></textarea>
  );
}
