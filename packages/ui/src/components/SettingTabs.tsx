"use client";
import { useState } from "react";

interface SettingTabsProps {
  tabs: {
    label: string;
    content: React.ReactNode;
  }[];
}

export default function SettingTabs({ tabs }: SettingTabsProps) {
  const [active, setActive] = useState(0);

  return (
    <div className="flex gap-6 w-full">
      <div className="flex flex-col w-40 shrink-0">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActive(i)}
            className={`text-left px-3 py-1.5 rounded-md text-md font-medium transition-colors cursor-pointer ${
              active === i
                ? "bg-(--accent) text-(--accent-foreground) hover:bg-(--accent)"
                : "text-(--muted-foreground) hover:text-(--foreground)"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 w-120">{tabs[active]?.content}</div>
    </div>
  );
}
