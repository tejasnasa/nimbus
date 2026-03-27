"use client";

import DocTabs from "@nimbus/ui/DocTabs";
import { useState } from "react";
import Canvas from "./Canvas";

const docList = [
  { label: "Document1", content: "// Document 1 content" },
  { label: "Document2", content: "// Document 2 content" },
  { label: "Document3", content: "// Document 3 content" },
];

export default function DocEditor() {
  const [tabs, setTabs] = useState(docList);
  const [active, setActive] = useState(0);

  return (
    <section className="w-3/4 flex-1 min-w-0 min-h-0 flex flex-col">
      <DocTabs
        tabs={tabs}
        setTabs={setTabs}
        active={active}
        setActive={setActive}
      />
      <div className="flex-1 min-h-0 min-w-0">
        <Canvas />
      </div>
    </section>
  );
}
