"use client";

import DocTabs from "@nimbus/ui/DocTabs";
import { useState } from "react";
import { Canvas } from "./Canvas";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";

const docList = [
  { label: "Document1", content: "// Document 1 content" },
  { label: "Document2", content: "// Document 2 content" },
  { label: "Document3", content: "// Document 3 content" },
];

export default function DocEditor() {
  const [tabs, setTabs] = useState(docList);
  const [active, setActive] = useState(0);

  return (
    <section className="w-3/4">
      <DocTabs
        tabs={tabs}
        setTabs={setTabs}
        active={active}
        setActive={setActive}
      />
      <ReactFlowProvider>
        <Canvas docId={tabs[active]?.label ?? ""} />
      </ReactFlowProvider>
    </section>
  );
}
