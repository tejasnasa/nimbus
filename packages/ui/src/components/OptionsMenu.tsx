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
}

export default function OptionMenu({ trigger, items }: OptionMenuProps) {
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
      <div
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-(--muted) rounded-md"
      >
        {trigger}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 min-w-44 rounded-md border border-(--border) bg-(--card) shadow-md p-1 animate-in fade-in-0 zoom-in-95">
          {items.map((item, i) => (
            <button
              key={i}
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.();
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 hover:cursor-pointer
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
