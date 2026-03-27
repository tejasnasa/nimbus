"use client";

import DocTabs from "@nimbus/ui/DocTabs";
import { useState } from "react";
import Canvas from "./Canvas";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type Doc = {
  label: string;
  elements: readonly OrderedExcalidrawElement[];
};

const initialDocs: Doc[] = [
  { label: "Doc 1", elements: [] },
  { label: "Doc 2", elements: [] },
  { label: "Doc 3", elements: [] },
];

export default function DocEditor() {
  const [tabs, setTabs] = useState(initialDocs);
  const [active, setActive] = useState(0);

  const current = tabs[active];
  if (!current) return null;

  return (
    <section className="w-3/4 flex-1 min-w-0 min-h-0 flex flex-col">
      <DocTabs
        tabs={tabs}
        setTabs={setTabs}
        active={active}
        setActive={setActive}
      />

      <div className="flex-1 min-h-0">
        <Canvas
          key={active}
          initialElements={current.elements}
          onChange={(elements) => {
            setTabs((prev) => {
              const doc = prev[active];
              if (!doc) return prev;

              if (doc.elements === elements) return prev;

              const next = [...prev];
              next[active] = {
                label: doc.label,
                elements,
              };

              return next;
            });
          }}
        />
      </div>
    </section>
  );
}
