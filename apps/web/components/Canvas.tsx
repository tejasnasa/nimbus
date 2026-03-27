"use client";

import "@excalidraw/excalidraw/index.css";
import dynamic from "next/dynamic";
import { useRef } from "react";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false },
);

interface CanvasProps {
  initialElements: readonly OrderedExcalidrawElement[];
  onChange: (elements: readonly OrderedExcalidrawElement[]) => void;
}

export default function Canvas({ initialElements, onChange }: CanvasProps) {
  const hasMounted = useRef(false);

  return (
    <div className="h-full w-full">
      <Excalidraw
        theme="dark"
        initialData={{ elements: initialElements }}
        onChange={(els) => {
          if (!hasMounted.current) {
            hasMounted.current = true;
            return;
          }

          onChange(els);
        }}
      />
    </div>
  );
}
