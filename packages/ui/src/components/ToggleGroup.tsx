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
    <div className="flex items-center gap-1 p-1 rounded-xl bg-(--card)/40 backdrop-blur-sm border border-(--border) w-fit">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => toggle(option)}
          className={`px-5 py-2 text-sm font-medium rounded-lg transition-all duration-300 cursor-pointer
            ${
              selected === option
                ? "bg-(--primary) text-(--primary-foreground) shadow-md shadow-(--primary)/20"
                : "hover:bg-(--muted) text-(--muted-foreground) hover:text-(--foreground)"
            }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
