/**
 * @module web/components/NotFoundPath
 * @description Monospace chip echoing the address that could not be found,
 * read from the current pathname.
 */
"use client";
import { usePathname } from "next/navigation";

/** The requested path, e.g. `/workspace/482`. */
export default function NotFoundPath() {
  const pathname = usePathname();

  return (
    <span className="inline-flex max-w-full items-center rounded-[10px] border border-(--line-1) bg-(--surface-1) px-3 py-2 font-mono text-xs break-all text-(--muted-foreground)">
      {pathname}
    </span>
  );
}
