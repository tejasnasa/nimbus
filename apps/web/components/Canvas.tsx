"use client";

import "@excalidraw/excalidraw/index.css";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { socket } from "../lib/socket";
const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false },
);

interface CanvasProps {
  initialElements: readonly OrderedExcalidrawElement[];
  workspaceId: string;
  documentId: string;
  onChange: (elements: readonly OrderedExcalidrawElement[]) => void;
}

export default function Canvas({
  initialElements,
  workspaceId,
  documentId,
	onChange
}: CanvasProps) {
  const excalidrawAPI = useRef<any>(null);
  const isRemoteUpdate = useRef(false);

  // receive updates
  useEffect(() => {
    socket.on("canvas:update", (data) => {
      if (data.documentId !== documentId) return;

      isRemoteUpdate.current = true;

      excalidrawAPI.current?.updateScene({
        elements: data.elements,
      });
    });

    return () => {
      socket.off("canvas:update");
    };
  }, [documentId]);

  return (
    <div className="h-full w-full">
      <Excalidraw
        initialData={{ elements: initialElements }}
        theme="dark"
        excalidrawAPI={(api) => {
          excalidrawAPI.current = api;
        }}
        onChange={(elements) => {
          if (isRemoteUpdate.current) {
            isRemoteUpdate.current = false;
            return;
          }

          // ✅ save locally
          onChange(elements);

          // ✅ send to others
          socket.emit("canvas:update", {
            workspaceId,
            documentId,
            elements,
          });
        }}
      />
    </div>
  );
}
