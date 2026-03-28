"use client";

import "@excalidraw/excalidraw/index.css";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { socket } from "../lib/socket";
const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false },
);

interface CanvasProps {
  initialElements: readonly OrderedExcalidrawElement[];
  documentId: string;
  onChange: (elements: readonly OrderedExcalidrawElement[]) => void;
}

export default function Canvas({
  initialElements,
  documentId,
  onChange,
}: CanvasProps) {
  const excalidrawAPI = useRef<ExcalidrawImperativeAPI | null>(null);
  const isRemoteUpdate = useRef(false);
  const isInitialized = useRef(false);

  useEffect(() => {
    if (!documentId) return;

    socket.emit("canvas:join", documentId);

    socket.on("canvas:state", (data) => {
      if (data.documentId !== documentId) return;
      isRemoteUpdate.current = true;
      excalidrawAPI.current?.updateScene({ elements: data.elements });
      isInitialized.current = true;
      setTimeout(() => (isRemoteUpdate.current = false), 200);
    });

    socket.on("canvas:update", (data) => {
      if (data.documentId !== documentId) return;
      isRemoteUpdate.current = true;
      excalidrawAPI.current?.updateScene({ elements: data.elements });
      setTimeout(() => (isRemoteUpdate.current = false), 200);
    });

    // Fallback in case we are the first user (no canvas:state received)
    const initTimeout = setTimeout(() => {
      isInitialized.current = true;
    }, 2000);

    return () => {
      socket.emit("canvas:leave", documentId);
      socket.off("canvas:update");
      socket.off("canvas:state");
      clearTimeout(initTimeout);
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
          if (isRemoteUpdate.current || !isInitialized.current) {
            return;
          }

          onChange(elements);

          socket.emit("canvas:update", {
            documentId,
            elements,
          });
        }}
      />
    </div>
  );
}
