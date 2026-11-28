/**
 * @module ui/components/DocTabs
 * @description Drag-reorderable document tab strip for the editor.
 *
 * Supports HTML5 drag-to-reorder with active-index remapping, a pulsing
 * indicator for `GENERATING` / `generating:*` tabs, a glow highlight for
 * newly AI-created tabs, hover-revealed close buttons, a `DOC` / `BRD` chip
 * telling documents from whiteboards, and an optional "new document" button
 * after the last tab.
 */
import { Dispatch, ReactNode, SetStateAction, useRef, useState } from "react";

/** Controlled tab-strip state shared with the parent `DocEditor`. */
interface DocTabsProps<T extends { id: string; label: string; type?: string }> {
  tabs: T[];
  setTabs: Dispatch<SetStateAction<T[]>>;
  active: number;
  setActive: Dispatch<SetStateAction<number>>;
  highlightTabId?: string | null;
  onCloseTab?: (id: string) => void;
  /** Content pinned to the strip's right edge, e.g. who else is in the document. */
  trailing?: ReactNode;
  /** Adds a "New document" button after the tabs; hidden when omitted. */
  onAddTab?: () => void;
}

/** Chip text and colour per document type; other types show no chip. */
const KIND_CHIP: Record<string, { code: string; color: string }> = {
  MARKDOWN: { code: "DOC", color: "text-(--violet)" },
  CANVAS: { code: "BRD", color: "text-(--lime)" },
};

/**
 * Document tab strip with drag-reorder.
 *
 * @param props.tabs - Ordered tabs; `type === "GENERATING"` (or id prefix
 *                     `generating:`) renders the pulsing AI indicator.
 * @param props.setTabs - Reordered array setter called on drop.
 * @param props.active - Index of the selected tab.
 * @param props.setActive - Selects a tab on click; remapped on reorder.
 * @param props.highlightTabId - Tab id receiving the `animate-border-glow`.
 * @param props.onCloseTab - Close-button handler; hidden when omitted.
 * @param props.trailing - Optional content pinned right of the (scrollable) tabs.
 * @param props.onAddTab - Shows the "New document" button and handles its click.
 */
export default function DocTabs<
  T extends { id: string; label: string; type?: string },
>({
  tabs,
  setTabs,
  active,
  setActive,
  highlightTabId,
  onCloseTab,
  trailing,
  onAddTab,
}: DocTabsProps<T>) {
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragIndex = useRef<number | null>(null);

  // Reorder via splice-move, then remap the active index so the same
  // document stays selected regardless of drag direction.
  const handleDrop = (i: number) => {
    const from = dragIndex.current;
    if (from === null || from === i) return;
    const reordered = [...tabs];
    const [moved] = reordered.splice(from, 1);
    if (!moved) return;
    reordered.splice(i, 0, moved);
    setActive((prev) => {
      if (prev === from) return i;
      if (from < prev && i >= prev) return prev - 1;
      if (from > prev && i <= prev) return prev + 1;
      return prev;
    });
    setTabs(reordered);
    setDragOver(null);
    dragIndex.current = null;
  };

  return (
    <div className="w-full select-none border-b border-(--line-1)">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto scrollbar-none">
          {tabs.map((tab, i) => {
            const isGenerating =
              tab.type === "GENERATING" || tab.id.startsWith("generating:");
            const chip = tab.type ? KIND_CHIP[tab.type] : undefined;
            return (
              <div
                key={tab.id}
                draggable
                onDragStart={() => (dragIndex.current = i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(i);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => handleDrop(i)}
                onDragEnd={() => {
                  setDragOver(null);
                  dragIndex.current = null;
                }}
                onClick={() => setActive(i)}
                className={`group relative flex min-h-8.5 min-w-30 max-w-52 shrink-0 cursor-pointer items-center gap-2 rounded-[9px] border py-1 pl-3 pr-8 text-[13px] transition-colors duration-200 ${
                  dragOver === i
                    ? "border-(--violet) opacity-50"
                    : active === i
                      ? "border-(--line-3) bg-(--surface-3) text-(--foreground)"
                      : "border-transparent text-(--muted-foreground) hover:text-(--foreground)"
                } ${highlightTabId === tab.id ? "animate-border-glow" : ""}`}
              >
                {isGenerating && (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-(--violet) opacity-75 animate-ping motion-reduce:animate-none"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-(--violet)"></span>
                  </span>
                )}
                {!isGenerating && chip && (
                  <span
                    className={`shrink-0 rounded-sm bg-(--surface-4) px-1.25 py-0.5 font-mono text-[9px] font-bold ${chip.color}`}
                  >
                    {chip.code}
                  </span>
                )}
                <span className="truncate w-full pr-1">{tab.label}</span>

                {onCloseTab && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-(--muted-foreground) opacity-0 transition-all hover:cursor-pointer hover:bg-(--surface-4) hover:text-(--foreground) focus-visible:opacity-100 group-hover:opacity-100"
                    title="Close tab"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
          {onAddTab && (
            <button
              type="button"
              aria-label="New document"
              title="New document"
              onClick={onAddTab}
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-dashed border-(--line-3) text-base text-(--muted-foreground) transition-colors hover:cursor-pointer hover:border-(--violet) hover:text-(--foreground)"
            >
              +
            </button>
          )}
        </div>
        {trailing ? (
          <div className="flex shrink-0 items-center gap-3">{trailing}</div>
        ) : null}
      </div>
    </div>
  );
}
