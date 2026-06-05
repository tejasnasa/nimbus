import { Dispatch, SetStateAction, useRef, useState } from "react";

interface DocTabsProps<T extends { id: string; label: string; type?: string }> {
  tabs: T[];
  setTabs: Dispatch<SetStateAction<T[]>>;
  active: number;
  setActive: Dispatch<SetStateAction<number>>;
  highlightTabId?: string | null;
  onCloseTab?: (id: string) => void;
}

export default function DocTabs<
  T extends { id: string; label: string; type?: string },
>({
  tabs,
  setTabs,
  active,
  setActive,
  highlightTabId,
  onCloseTab,
}: DocTabsProps<T>) {
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragIndex = useRef<number | null>(null);

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
    <div className="w-full bg-(--card)/20 backdrop-blur-sm select-none">
      <div className="border-b border-(--border)">
        <div className="flex flex-nowrap overflow-x-auto scrollbar-none items-center">
          {tabs.map((tab, i) => {
            const isGenerating =
              tab.type === "GENERATING" || tab.id.startsWith("generating:");
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
                className={`group relative flex items-center gap-2 py-2.5 pl-4 pr-9 text-sm font-medium transition-all duration-200 -mb-px border-b-2 cursor-pointer min-w-30 max-w-50 ${
                  dragOver === i
                    ? "border-(--primary) opacity-50"
                    : active === i
                      ? "border-(--primary) text-(--foreground) bg-(--primary)/5"
                      : "border-transparent text-(--muted-foreground) hover:text-(--foreground) hover:bg-(--muted)/30"
                } ${highlightTabId === tab.id ? "animate-border-glow" : ""}`}
              >
                {isGenerating && (
                  <span className="flex h-2 w-2 relative shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-(--primary) opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-(--primary)"></span>
                  </span>
                )}
                <span className="truncate w-full pr-1">{tab.label}</span>

                {onCloseTab && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-(--muted-foreground)/60 hover:text-(--foreground) hover:bg-(--muted)/85 transition-all opacity-0 group-hover:opacity-100 hover:cursor-pointer"
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
        </div>
      </div>
    </div>
  );
}
