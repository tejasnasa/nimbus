"use client";

import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { socket } from "../lib/socket";
const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false },
);

interface CanvasProps {
  initialElements: readonly OrderedExcalidrawElement[];
  documentId: string;
}

export default function Canvas({ initialElements, documentId }: CanvasProps) {
  const excalidrawAPI = useRef<ExcalidrawImperativeAPI | null>(null);
  const isRemoteUpdate = useRef(false);
  const isInitialized = useRef(false);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestElementsRef =
    useRef<readonly OrderedExcalidrawElement[]>(initialElements);

  const initialData = useMemo(
    () => ({ elements: [...initialElements] }),
    [documentId],
  );

  const handleExcalidrawApi = useCallback((api: ExcalidrawImperativeAPI) => {
    excalidrawAPI.current = api;
  }, []);

  useEffect(() => {
    if (!documentId) return;

    isInitialized.current = false;
    socket.emit("canvas:join", documentId);

    const handleState = (data: {
      documentId: string;
      elements: readonly OrderedExcalidrawElement[];
    }) => {
      if (data.documentId !== documentId) return;
      isRemoteUpdate.current = true;
      excalidrawAPI.current?.updateScene({ elements: data.elements });
      isInitialized.current = true;
      setTimeout(() => {
        isRemoteUpdate.current = false;
      }, 200);
    };

    const handleUpdate = (data: {
      documentId: string;
      elements: readonly OrderedExcalidrawElement[];
    }) => {
      if (data.documentId !== documentId) return;
      isRemoteUpdate.current = true;
      excalidrawAPI.current?.updateScene({ elements: data.elements });
      setTimeout(() => {
        isRemoteUpdate.current = false;
      }, 200);
    };

    socket.on("canvas:state", handleState);
    socket.on("canvas:update", handleUpdate);

    return () => {
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
      socket.emit("canvas:leave", documentId);
      socket.off("canvas:state", handleState);
      socket.off("canvas:update", handleUpdate);
      isInitialized.current = false;
    };
  }, [documentId]);

  return (
    <div className="h-full w-full">
      <Excalidraw
        initialData={initialData}
        theme="dark"
        excalidrawAPI={handleExcalidrawApi}
        onChange={(elements) => {
          if (isRemoteUpdate.current || !isInitialized.current) {
            return;
          }

          latestElementsRef.current = elements;
          if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
          emitTimerRef.current = setTimeout(() => {
            socket.emit("canvas:update", {
              documentId,
              elements: latestElementsRef.current,
            });
          }, 300);
        }}
      />
    </div>
  );
}
