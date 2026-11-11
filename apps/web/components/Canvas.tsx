"use client";

import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { PresenceUser } from "@nimbus/types";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  collaboratorFromPointer,
  elementsSignature,
  pruneStale,
  toSceneCollaborators,
  type PointerMessage,
  type TrackedCollaborator,
} from "../lib/canvasPresence";
import {
  peersFromRoster,
  throttle,
  type LocalPresenceUser,
  type PresencePeer,
  type Throttled,
} from "../lib/presence";
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
 * Presence: the local pointer is sent as `canvas:pointer` (throttled to about
 * 20 a second, with the current selection), and other members' pointers are
 * drawn through Excalidraw's collaborator layer. A collaborator that has been
 * silent for 10 seconds is dropped from the scene, and everyone is dropped on
 * `canvas:pointer-leave`. People who have sent a pointer and not left are
 * reported through `onPeersChange` for the header avatars.
 *
 * @important The board is read-only until the authoritative `canvas:state`
 *            arrives. Excalidraw renders local edits immediately even when the
 *            component drops their emission, so an editable pre-state board
 *            shows strokes that the joining `updateScene` then silently
 *            erases. It also supplies the `initialized` flag the server needs
 *            to tell "not loaded yet" from "deleted everything".
 *
 * @important Collaborator updates make Excalidraw call `onChange` even though
 *            no element changed. Edits are therefore emitted only when the
 *            element signature differs from the last one synced; without that,
 *            every remote pointer would make an idle viewer re-send the whole
 *            canvas and could overwrite a peer's edit that is still in flight.
 */
interface CanvasProps {
  /** Snapshot for first paint; the server state wins once it arrives. */
  initialElements: readonly OrderedExcalidrawElement[];
  /** Document cuid (socket room key). */
  documentId: string;
  /** Signed-in user, so their own pointer is never listed as "someone else". */
  user?: LocalPresenceUser;
  /** Called with the other people on the canvas when that list changes. */
  onPeersChange?: (peers: PresencePeer[]) => void;
}

/** How long a remote `updateScene` is assumed to be driving `onChange`. */
const REMOTE_GUARD_MS = 200;
/** Local-edit debounce before a `canvas:update` is emitted. */
const EMIT_DEBOUNCE_MS = 300;
/** Where Excalidraw reports the pointer. */
type PointerPosition = { x: number; y: number; tool: "pointer" | "laser" };
/** Minimum gap between pointer events: 50 ms is 20 a second. */
const POINTER_INTERVAL_MS = 50;
/** How often silent collaborators are swept. */
const PRUNE_INTERVAL_MS = 2_000;

/**
 * Collaborative canvas for one document (remount per `documentId`).
 */
export default function Canvas({
  initialElements,
  documentId,
  user,
  onPeersChange,
}: CanvasProps) {
  const excalidrawAPI = useRef<ExcalidrawImperativeAPI | null>(null);
  const isRemoteUpdate = useRef(false);
  const isInitialized = useRef(false);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestElementsRef =
    useRef<readonly OrderedExcalidrawElement[]>(initialElements);

  const lastSignatureRef = useRef<number | null>(null);
  const selectedIdsRef = useRef<string[]>([]);
  const pointerEmitRef = useRef<Throttled<
    [PointerPosition, "up" | "down"]
  > | null>(null);
  const userIdRef = useRef(user?.id);
  const onPeersChangeRef = useRef(onPeersChange);
  useEffect(() => {
    userIdRef.current = user?.id;
    onPeersChangeRef.current = onPeersChange;
  }, [user, onPeersChange]);

  // Mirrors `isInitialized` into render state so the board can be locked until
  // the server state lands (see the module note).
  const [isReady, setIsReady] = useState(false);

  // WARNING: seeded once per mount. Excalidraw consumes initialData a single
  // time, and the parent remounts (key) per document, so later changes to
  // initialElements intentionally do not re-seed the scene.
  const [initialData] = useState(() => ({ elements: [...initialElements] }));

  const handleExcalidrawApi = useCallback((api: ExcalidrawImperativeAPI) => {
    excalidrawAPI.current = api;
  }, []);

  useEffect(() => {
    if (!documentId) return;

    isInitialized.current = false;
    setIsReady(false);
    socket.emit("canvas:join", documentId);

    // Pointers drawn on the scene (silent ones expire) and everyone who has
    // sent one and not yet left (the header avatars).
    const tracked = new Map<string, TrackedCollaborator>();
    const roster = new Map<string, PresenceUser>();

    const showCollaborators = () => {
      excalidrawAPI.current?.updateScene({
        collaborators: toSceneCollaborators(tracked),
      });
    };
    const reportPeers = () => {
      onPeersChangeRef.current?.(
        peersFromRoster(roster.values(), userIdRef.current),
      );
    };

    const handlePointer = (data: PointerMessage) => {
      if (data.canvasId !== documentId) return;
      tracked.set(data.socketId, {
        collaborator: collaboratorFromPointer(data),
        seenAt: Date.now(),
      });
      roster.set(data.socketId, data.user);
      showCollaborators();
      reportPeers();
    };

    const handlePointerLeave = (data: {
      canvasId: string;
      socketId: string;
    }) => {
      if (data.canvasId !== documentId) return;
      const hadPointer = tracked.delete(data.socketId);
      const wasKnown = roster.delete(data.socketId);
      if (hadPointer) showCollaborators();
      if (wasKnown) reportPeers();
    };

    const pruneTimer = setInterval(() => {
      if (pruneStale(tracked, Date.now())) showCollaborators();
    }, PRUNE_INTERVAL_MS);

    pointerEmitRef.current = throttle(
      (pointer: PointerPosition, button: "up" | "down") => {
        if (!isInitialized.current) return;
        socket.emit("canvas:pointer", {
          canvasId: documentId,
          x: pointer.x,
          y: pointer.y,
          tool: pointer.tool,
          button,
          selectedElementIds: selectedIdsRef.current,
        });
      },
      POINTER_INTERVAL_MS,
    );

    const handleState = (data: {
      documentId: string;
      elements: readonly OrderedExcalidrawElement[];
    }) => {
      if (data.documentId !== documentId) return;
      isRemoteUpdate.current = true;
      lastSignatureRef.current = elementsSignature(data.elements);
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
      lastSignatureRef.current = elementsSignature(data.elements);
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
    socket.on("canvas:pointer", handlePointer);
    socket.on("canvas:pointer-leave", handlePointerLeave);
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
      socket.off("canvas:pointer", handlePointer);
      socket.off("canvas:pointer-leave", handlePointerLeave);
      socket.off("connect", handleConnect);
      clearInterval(pruneTimer);
      pointerEmitRef.current?.cancel();
      pointerEmitRef.current = null;
      onPeersChangeRef.current?.([]);
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
        onPointerUpdate={({ pointer, button }) =>
          pointerEmitRef.current?.(pointer, button)
        }
        onChange={(elements, appState) => {
          selectedIdsRef.current = Object.keys(
            appState?.selectedElementIds ?? {},
          );

          // Guard: drop remote replays and pre-join strokes — only initialized
          // local edits are emitted (debounced below).
          if (isRemoteUpdate.current || !isInitialized.current) {
            return;
          }

          // Not an edit: a collaborator, tool or scroll change also lands here.
          const signature = elementsSignature(elements);
          if (signature === lastSignatureRef.current) return;
          lastSignatureRef.current = signature;

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
