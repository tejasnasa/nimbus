"use client";
import { useState, useRef, useEffect } from "react";

interface OptionItem {
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

interface OptionMenuProps {
  trigger: React.ReactNode;
  items: OptionItem[];
  size: "sm" | "lg";
  direction: "left" | "right";
  className?: string;
}

export default function OptionMenu({
  trigger,
  items,
  size,
  direction,
  className,
}: OptionMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>

      {open && (
        <div
          className={`absolute z-50 rounded-md border border-(--border) bg-(--card) shadow-md p-1 animate-in fade-in-0 zoom-in-95 ${direction === "left" ? "right-0" : "left-0"} ${className || ""}`}
        >
          {items.map((item, i) => (
            <button
              key={i}
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.();
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-sm px-3 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 hover:cursor-pointer
                ${size === "sm" && "text-xs"}
                ${size === "lg" && "text-sm"}
                ${
                  item.destructive
                    ? "text-(--destructive) hover:bg-(--muted) "
                    : "text-(--foreground) hover:bg-(--muted)"
                }`}
            >
              {item.icon && <span className="w-4 h-4">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
