/**
 * @module ui/components/SettingTabs
 * @description Settings modal body: a full-height navigation column on the
 * left (an optional heading above vertical tab buttons) and a content column on
 * the right with its own header (the active tab's title and description) and a
 * slot for a close control. Used by WorkspaceSettings.
 *
 * The selected tab is shown with a filled background and bold text only; there
 * is no coloured edge or inset shadow.
 */
"use client";
import { useState, type ReactNode } from "react";

/** One tab: its nav label, panel and optional header copy. */
interface SettingTab {
  label: string;
  content: ReactNode;
  /** One line under the title in the content header. */
  description?: string;
  /** Indents the nav entry and sets it in a smaller size (a sub-section). */
  nested?: boolean;
}

/** Label/content pairs; content is rendered lazily for the active tab only. */
interface SettingTabsProps {
  tabs: SettingTab[];
  /** Label of the tab shown first. Unknown or absent means the first tab. */
  defaultTab?: string;
  /** Heading block at the top of the nav column. */
  heading?: ReactNode;
  /** Control pinned to the right of the content header, e.g. a close button. */
  headerAction?: ReactNode;
}

/**
 * Vertical tab navigation for settings panels.
 *
 * @param props.tabs - Ordered tabs; the active index starts at 0.
 * @param props.defaultTab - Label of the tab to open first, when it exists.
 * @param props.heading - Optional heading above the nav entries.
 * @param props.headerAction - Optional control at the end of the content header.
 */
export default function SettingTabs({
  tabs,
  defaultTab,
  heading,
  headerAction,
}: SettingTabsProps) {
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      tabs.findIndex((tab) => tab.label === defaultTab),
    ),
  );
  const current = tabs[active];

  return (
    <div className="flex h-full min-h-0 w-full">
      <nav
        aria-label="Settings sections"
        className="flex w-57.5 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-(--line-1) bg-(--panel) px-3.5 py-5.5"
      >
        {heading && <div className="px-2.5 pb-4">{heading}</div>}
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            aria-current={active === i ? "page" : undefined}
            className={`flex min-h-9.5 items-center rounded-[9px] pr-3 text-left transition-colors duration-200 cursor-pointer ${
              tab.nested ? "pl-6.5 text-[13px]" : "pl-3 text-sm"
            } ${
              active === i
                ? "bg-(--surface-4) font-semibold text-(--foreground)"
                : "text-(--muted-foreground) hover:bg-(--surface-1) hover:text-(--foreground)"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-(--line-1) px-6.5 py-5">
          <div className="flex min-w-0 flex-col gap-0.75">
            <h2 className="truncate font-display text-[22px] font-semibold">
              {current?.label}
            </h2>
            {current?.description && (
              <p className="text-[13px] text-(--muted-foreground)">
                {current.description}
              </p>
            )}
          </div>
          {headerAction}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6.5 py-5.5 scrollbar-thin">
          {current?.content}
        </div>
      </div>
    </div>
  );
}
