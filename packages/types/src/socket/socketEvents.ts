import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { Message } from "../api/message";
import type { VoiceUser } from "./voice";

/**
 * Events emitted by the client and handled by the API server.
 *
 * Event names follow the `namespace:verb` convention.
 * All connections are pre-authenticated by the Socket.IO handshake middleware,
 * so handlers can trust `socket.data.user`.
 */
export type ClientToServerEvents = {
  // ── Workspace & chat ──
  /** Join a workspace room to receive chat, presence, doc, and canvas events. */
  "workspace:join": (workspaceId: string) => void;
  /** Leave the workspace room. */
  "workspace:leave": (workspaceId: string) => void;
  /** Send a chat message; `@nimbusbot` mentions trigger the AI pipeline. */
  "message:send": (data: {
    workspaceId: string;
    content: string;
    /** Cloudinary URL of an image in this workspace's chat folder. */
    imageUrl?: string;
  }) => void;
  /** Start/stop the user's typing indicator in the room. */
  "typing:start": (workspaceId: string) => void;
  "typing:stop": (workspaceId: string) => void;

  // ── Canvas (full-state sync, last-write-wins) ──
  /** Join a canvas room; server replies with `canvas:state`. */
  "canvas:join": (canvasId: string) => void;
  "canvas:leave": (canvasId: string) => void;
  /**
   * Replace the room's full elements array (no CRDT — full state sync).
   *
   * `initialized` must be `true` once the sender has applied the authoritative
   * `canvas:state`. The server drops an empty array from a sender that has not,
   * because "I have not loaded yet" and "I deleted everything" are otherwise
   * indistinguishable — and the former must not wipe the room.
   */
  "canvas:update": (data: {
    documentId: string;
    elements: readonly OrderedExcalidrawElement[];
    initialized?: boolean;
  }) => void;

  // ── Markdown docs (Yjs binary updates) ──
  /** Join a doc room; server replies with `doc:state`. */
  "doc:join": (docId: string) => void;
  /** Push a binary Yjs update (`Array.from(Y.encodeStateAsUpdate)` delta). */
  "doc:update": (docId: string, update: number[]) => void;
  "doc:leave": (docId: string) => void;
};

/**
 * Events emitted by the API server and consumed by the client.
 *
 * Grouped by feature area: chat/presence, canvas, markdown docs, and the voice roster.
 */
export type ServerToClientEvents = {
  // ── Chat & presence ──
  /** A new chat message was persisted and should be appended to the log. */
  "message:new": (message: Message) => void;
  "presence:joined": (data: { userId: string; name: string }) => void;
  "presence:left": (data: { userId: string }) => void;
  /** Full snapshot of online user IDs sent on workspace join. */
  "presence:online_users": (userIds: string[]) => void;
  "typing:start": (data: { userId: string; name: string }) => void;
  "typing:stop": (data: { userId: string; name: string }) => void;
  /**
   * A workspace-scoped request was refused — currently a `workspace:join` from a
   * non-member. Sent instead of failing silently, so the
   * client can distinguish a denial from a request still in flight.
   */
  "workspace:error": (message: string) => void;

  // ── Canvas ──
  /** Initial full elements array on join. */
  "canvas:state": (data: {
    documentId: string;
    elements: readonly OrderedExcalidrawElement[];
  }) => void;
  /** Remote full-state replacement broadcast to other room members. */
  "canvas:update": (data: {
    documentId: string;
    elements: readonly OrderedExcalidrawElement[];
  }) => void;
  /** Canvas operation rejected (e.g. invalid or conflicting update). */
  "canvas:error": (message: string) => void;

  // ── Markdown docs ──
  /** Initial Yjs state on join, as a binary update encoded as `number[]`. */
  "doc:state": (update: number[]) => void;
  /** Remote Yjs update to apply locally with origin `"socket"`. */
  "doc:update": (update: number[]) => void;
  "doc:error": (message: string) => void;

  // ── AI generation (NimbusBot) ──
  /** Bot started generating a document; clients show a GENERATING tab. */
  "doc:ai:start": (data: {
    type: "MARKDOWN" | "CANVAS";
    label: string;
  }) => void;
  /** Streaming markdown token for live preview during generation. */
  "doc:ai:thinking": (data: { token: string }) => void;
  /** Generation finished; replaces the GENERATING tab with the real document. */
  "doc:ai:complete": (data: {
    documentId: string;
    label: string;
    type: "MARKDOWN" | "CANVAS";
    canvasData?: readonly OrderedExcalidrawElement[];
  }) => void;
  "doc:ai:error": (data: { message: string }) => void;
  /**
   * The triggering user's AI request was refused (entitlement), not failed.
   * Sent ONLY to the asking socket; never broadcast, because the reason is
   * personal — e.g. a quota exhaustion must not leak to a second tab. Drives
   * the chat-side refusal banner and (for documents) replaces the optimistic
   * "creating it now…" acknowledgement so no GENERATING tab appears.
   */
  "ai:refused": (data: {
    feature: "chat" | "markdown" | "canvas" | "vision";
    reason: string;
    message: string;
    cta: "add-key" | "manage-ai" | null;
  }) => void;

  // ── Voice ──
  /**
   * The workspace's call roster. Sent to the whole workspace room whenever a
   * participant joins or leaves the media room, and to a socket alone when it
   * joins the workspace, so the sidebar shows who is on the call before the
   * user does. The roster is the server's view, fed by the media server's
   * webhooks; the call itself runs between each browser and the media server.
   */
  "voice:roster": (data: { users: VoiceUser[] }) => void;
};
