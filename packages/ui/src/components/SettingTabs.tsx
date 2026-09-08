/**
 * @module ui/components/SettingTabs
 * @description Vertical settings navigation: left column of tab buttons
 * switching the right-hand content panel. Used by WorkspaceSettings.
 */
"use client";
import { useState } from "react";

/** Label/content pairs; content is rendered lazily for the active tab only. */
interface SettingTabsProps {
  tabs: {
    label: string;
    content: React.ReactNode;
  }[];
}

/**
 * Vertical tab navigation for settings panels.
 *
 * @param props.tabs - Ordered tabs; the active index starts at 0.
 */
export default function SettingTabs({ tabs }: SettingTabsProps) {
  const [active, setActive] = useState(0);

  return (
    <div className="flex gap-8 w-full">
      <div className="flex flex-col w-44 shrink-0 gap-1">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActive(i)}
            className={`text-left px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
              active === i
                ? "bg-(--primary)/15 text-(--primary) shadow-sm"
                : "text-(--muted-foreground) hover:text-(--foreground) hover:bg-(--muted)/50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0">{tabs[active]?.content}</div>
    </div>
  );
}
