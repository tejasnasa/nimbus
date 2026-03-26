"use client";

import { Editor } from "@monaco-editor/react";
import DocTabs from "@nimbus/ui/DocTabs";
import { initializeTheme } from "@nimbus/ui/themes/theme";
import { useState } from "react";

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
      <Editor
        width="100%"
        height="100%"
        language="cpp"
        value={tabs[active]?.content ?? ""}
        theme={"customDarkTheme"}
        options={{
          fontSize: 20,
          fontFamily: "JetBrains Mono, Fira Code, monospace",
        }}
        beforeMount={(monaco) => {
          initializeTheme(monaco);
        }}
      />
    </section>
  );
}
