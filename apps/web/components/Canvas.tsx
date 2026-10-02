"use client";

import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../lib/socket";
const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false },
);

/**
 * @module web/components/Canvas
 * @description Excalidraw whiteboard with full-state socket sync.
 *
 * Lifecycle: `canvas:join` → server replays authoritative state →
 * `updateScene` under a remote-update guard → local `onChange` debounced
 * (300ms) back to `canvas:update`. Guards on both sides prevent echo loops and
 * pre-join emissions.
 *
 * @important The board is read-only until the authoritative `canvas:state`
 *            arrives. Excalidraw renders local edits immediately even when the
 *            component drops their emission, so an editable pre-state board
 *            shows strokes that the joining `updateScene` then silently
 *            erases. It also supplies the `initialized` flag the server needs
 *            to tell "not loaded yet" from "deleted everything".
 */
interface CanvasProps {
  /** Snapshot for first paint; the server state wins once it arrives. */
  initialElements: readonly OrderedExcalidrawElement[];
  /** Document cuid (socket room key). */
  documentId: string;
}

/** How long a remote `updateScene` is assumed to be driving `onChange`. */
const REMOTE_GUARD_MS = 200;
/** Local-edit debounce before a `canvas:update` is emitted. */
const EMIT_DEBOUNCE_MS = 300;

/**
 * Collaborative canvas for one document (remount per `documentId`).
 */
export default function Canvas({ initialElements, documentId }: CanvasProps) {
  const excalidrawAPI = useRef<ExcalidrawImperativeAPI | null>(null);
  const isRemoteUpdate = useRef(false);
  const isInitialized = useRef(false);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestElementsRef =
    useRef<readonly OrderedExcalidrawElement[]>(initialElements);

  // Mirrors `isInitialized` into render state so the board can be locked until
  // the server state lands (see the module note).
  const [isReady, setIsReady] = useState(false);

  // WARNING: memoized on documentId only — Excalidraw consumes initialData
  // once per mount, and the parent remounts (key) per document, so updates to
  // initialElements after mount intentionally do not re-seed the scene.
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
    setIsReady(false);
    socket.emit("canvas:join", documentId);

    const handleState = (data: {
      documentId: string;
      elements: readonly OrderedExcalidrawElement[];
    }) => {
      if (data.documentId !== documentId) return;
      isRemoteUpdate.current = true;
      excalidrawAPI.current?.updateScene({ elements: data.elements });
      isInitialized.current = true;
      setIsReady(true);
      setTimeout(() => {
        isRemoteUpdate.current = false;
      }, REMOTE_GUARD_MS);
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
      }, REMOTE_GUARD_MS);
    };

    // A reconnect hands the server a brand-new socket with no rooms, so the
    // canvas room must be re-entered or every later update is rejected and
    // peers' edits are never received.
    const handleConnect = () => {
      socket.emit("canvas:join", documentId);
    };

    const handleError = (message: string) => {
      console.error("Canvas sync error:", message);
    };

    socket.on("canvas:state", handleState);
    socket.on("canvas:update", handleUpdate);
    socket.on("connect", handleConnect);
    socket.on("canvas:error", handleError);

    return () => {
      // Flush a pending debounce before tearing down — otherwise the last
      // 300ms of strokes die with the tab switch.
      if (emitTimerRef.current) {
        clearTimeout(emitTimerRef.current);
        emitTimerRef.current = null;

        if (isInitialized.current) {
          socket.emit("canvas:update", {
            documentId,
            elements: latestElementsRef.current,
            initialized: true,
          });
        }
      }

      socket.off("canvas:state", handleState);
      socket.off("canvas:update", handleUpdate);
      socket.off("connect", handleConnect);
      socket.off("canvas:error", handleError);
      socket.emit("canvas:leave", documentId);
      isInitialized.current = false;
    };
  }, [documentId]);

  return (
    <div className="h-full w-full">
      <Excalidraw
        initialData={initialData}
        theme="dark"
        viewModeEnabled={!isReady}
        excalidrawAPI={handleExcalidrawApi}
        onChange={(elements) => {
          // Guard: drop remote replays and pre-join strokes — only initialized
          // local edits are emitted (debounced below).
          if (isRemoteUpdate.current || !isInitialized.current) {
            return;
          }

          latestElementsRef.current = elements;
          if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
          emitTimerRef.current = setTimeout(() => {
            emitTimerRef.current = null;
            socket.emit("canvas:update", {
              documentId,
              elements: latestElementsRef.current,
              initialized: true,
            });
          }, EMIT_DEBOUNCE_MS);
        }}
      />
    </div>
  );
}
