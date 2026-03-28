import { useState, useRef, Dispatch, SetStateAction } from "react";

interface DocTabsProps<T extends { label: string }> {
  tabs: T[];
  setTabs: Dispatch<SetStateAction<T[]>>;
  active: number;
  setActive: Dispatch<SetStateAction<number>>;
}

export default function DocTabs<T extends { label: string }>({
  tabs,
  setTabs,
  active,
  setActive,
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
    <div className="w-full">
      <div className="border-b border-(--border)">
        <div className="flex gap-4">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
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
              className={`py-2 px-4 text-md font-medium transition-colors -mb-px border-b-2 ${
                dragOver === i
                  ? "border-(--primary) opacity-50"
                  : active === i
                    ? "border-(--primary) text-(--foreground)"
                    : "border-transparent text-(--muted-foreground) hover:text-(--foreground) hover:border-(--border) hover:cursor-pointer"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
