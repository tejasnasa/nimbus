/**
 * @module web/lib/canvasPresence
 * @description Turns `canvas:pointer` events into the collaborator map
 * Excalidraw draws, drops collaborators that have gone quiet, and detects
 * whether a scene actually changed.
 *
 * @important Pointer traffic must never be mistaken for an edit. Excalidraw
 *            calls `onChange` for any state change, including a collaborator
 *            update, and the canvas syncs by replacing the whole element array;
 *            re-sending an unchanged array on every remote pointer would let a
 *            quiet viewer overwrite a peer's in-flight edit. `elementsSignature`
 *            is what lets the sync tell the two apart.
 */
import type { Collaborator, SocketId } from "@excalidraw/excalidraw/types";
import type { ServerToClientEvents } from "@nimbus/types";

/** How long a collaborator's pointer stays on screen without an update. */
export const COLLABORATOR_TTL_MS = 10_000;

/** A `canvas:pointer` payload. */
export type PointerMessage = Parameters<
  ServerToClientEvents["canvas:pointer"]
>[0];

/** A collaborator and when it last moved. */
export type TrackedCollaborator = {
  collaborator: Collaborator;
  seenAt: number;
};

/**
 * Builds Excalidraw's collaborator for a relayed pointer.
 *
 * @param event - The server's pointer message.
 */
export function collaboratorFromPointer(event: PointerMessage): Collaborator {
  const selected: Record<string, true> = {};
  for (const id of event.selectedElementIds ?? []) selected[id] = true;

  return {
    pointer: { x: event.x, y: event.y, tool: event.tool ?? "pointer" },
    button: event.button ?? "up",
    selectedElementIds: selected,
    username: event.user.name,
    id: event.user.userId,
    socketId: event.socketId as SocketId,
    avatarUrl: event.user.image ?? undefined,
    // Dark text on the cursor label: the palette is light enough for it.
    color: { background: event.user.color, stroke: "#111827" },
  };
}

/**
 * Removes collaborators silent for longer than the TTL.
 *
 * @param tracked - Collaborators by socket id; mutated in place.
 * @param now - Current time in milliseconds.
 * @returns Whether anything was removed.
 */
export function pruneStale(
  tracked: Map<string, TrackedCollaborator>,
  now: number,
): boolean {
  let removed = false;
  for (const [socketId, entry] of tracked) {
    if (now - entry.seenAt > COLLABORATOR_TTL_MS) {
      tracked.delete(socketId);
      removed = true;
    }
  }
  return removed;
}

/** The map `updateScene({ collaborators })` expects. */
export function toSceneCollaborators(
  tracked: ReadonlyMap<string, TrackedCollaborator>,
): Map<SocketId, Collaborator> {
  return new Map(
    [...tracked].map(([socketId, { collaborator }]) => [
      socketId as SocketId,
      collaborator,
    ]),
  );
}

/**
 * A cheap fingerprint of a scene: it changes when an element is added, removed
 * or mutated, and not when only the appState (tool, scroll, collaborators) does.
 *
 * @param elements - The scene's elements, deleted ones included.
 */
export function elementsSignature(
  elements: readonly { id: string; version?: number; versionNonce?: number }[],
): number {
  let hash = elements.length;
  for (const element of elements) {
    for (let i = 0; i < element.id.length; i++) {
      hash = (Math.imul(hash, 31) + element.id.charCodeAt(i)) | 0;
    }
    hash = (Math.imul(hash, 31) + (element.version ?? 0)) | 0;
    hash = (Math.imul(hash, 31) + (element.versionNonce ?? 0)) | 0;
  }
  return hash;
}
