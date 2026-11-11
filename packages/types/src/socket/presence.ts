/**
 * @module socket/presence
 * @description Identity of a collaborator shown on a shared document: the
 * name and colour drawn beside a cursor or pointer, and the avatar in the
 * editor header.
 *
 * Presence is transient and never persisted. The server stamps `userId` and
 * `name` from the authenticated socket, so a client cannot present itself as
 * someone else.
 */

/** A collaborator as other people see them on a document. */
export type PresenceUser = {
  userId: string;
  name: string;
  /** `#rrggbb`, derived from `userId`, so it is stable across sessions. */
  color: string;
  /** The user's picture from their session, or `null` for the default avatar. */
  image: string | null;
};

/** What the pointer is doing, mirroring Excalidraw's collaborator pointer. */
export type PointerTool = "pointer" | "laser";
