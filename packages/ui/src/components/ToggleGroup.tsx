"use client";
import { useState } from "react";

interface ToggleGroupProps {
  options: string[];
  onChange?: (selected: string) => void;
}

export default function ToggleGroup({ options, onChange }: ToggleGroupProps) {
  const [selected, setSelected] = useState<string>(options[0] ?? "");

  function toggle(option: string) {
    setSelected(option);
    onChange?.(option);
  }

  return (
    <div className="flex items-center gap-1 border border-(--border) mx-28 my-4 p-0 w-fit">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => toggle(option)}
          className={`px-6 py-2 text-sm font-medium transition-all
            ${
              selected === option
                ? "bg-(--primary) text-(--primary-foreground)"
                : "hover:bg-(--muted) text-(--muted-foreground) hover:text-(--foreground)"
            }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
