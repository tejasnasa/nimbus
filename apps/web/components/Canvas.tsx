"use client";

import "@excalidraw/excalidraw/index.css";
import { useState } from "react";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import dynamic from "next/dynamic";
const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false },
);

export default function Canvas() {
  const [elements, setElements] = useState<readonly OrderedExcalidrawElement[]>(
    [],
  );

  return (
    <div className="h-full min-h-0 min-w-0 w-full">
      <Excalidraw
        initialData={{
          elements,
          appState: {
            viewBackgroundColor: "#09090C",
            gridSize: 20,
          },
        }}
        onChange={(elements) => {
          setElements(elements);
          console.log("canvas updated", elements);
        }}
      />
    </div>
  );
}
