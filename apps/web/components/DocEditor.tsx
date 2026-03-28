"use client";

import DocTabs from "@nimbus/ui/DocTabs";
import { useState } from "react";
import Canvas from "./Canvas";
import { ClientDocument } from "../api/document";
import { MarkdownEditor } from "./MarkdownEditor";

export default function DocEditor({
  documents,
}: {
  documents: ClientDocument[];
}) {
  const [tabs, setTabs] = useState(documents);
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
        {current.type == "CANVAS" && (
          <Canvas
            key={active}
            initialElements={current.elements}
            documentId={current.id}
            onChange={(elements) => {
              setTabs((prev) => {
                const doc = prev[active];
                if (!doc) return prev;

                if (doc.elements === elements) return prev;

                const next = [...prev];
                next[active] = {
                  id: doc.id,
                  label: doc.label,
                  elements,
                  type: doc.type,
                  yjsState: doc.yjsState,
                };

                return next;
              });
            }}
          />
        )}
        {current.type == "MARKDOWN" && (
          <MarkdownEditor key={active} initialContent={"# Hello World"} />
        )}
      </div>
    </section>
  );
}
