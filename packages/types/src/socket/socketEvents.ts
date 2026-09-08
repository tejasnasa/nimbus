import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { Message } from "../api/message";
import type { VoiceUser } from "./voice";

/**
 * Events emitted by the client and handled by the API server.
 *
 * Event names follow the `namespace:verb` convention (AGENTS.md §5).
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
  "message:send": (data: { workspaceId: string; content: string }) => void;
  /** Start/stop the user's typing indicator in the room. */
  "typing:start": (workspaceId: string) => void;
  "typing:stop": (workspaceId: string) => void;

  // ── Canvas (full-state sync, last-write-wins) ──
  /** Join a canvas room; server replies with `canvas:state`. */
  "canvas:join": (canvasId: string) => void;
  "canvas:leave": (canvasId: string) => void;
  /** Replace the room's full elements array (no CRDT — full state sync). */
  "canvas:update": (data: {
    documentId: string;
    elements: readonly OrderedExcalidrawElement[];
  }) => void;

  // ── Markdown docs (Yjs binary updates) ──
  /** Join a doc room; server replies with `doc:state`. */
  "doc:join": (docId: string) => void;
  /** Push a binary Yjs update (`Array.from(Y.encodeStateAsUpdate)` delta). */
  "doc:update": (docId: string, update: number[]) => void;
  "doc:leave": (docId: string) => void;

  // ── Voice (WebRTC signaling relay) ──
  "voice:join": (workspaceId: string) => void;
  "voice:leave": (workspaceId: string) => void;
  /** SDP offer relayed to a specific peer by userId. */
  "voice:offer": (data: {
    workspaceId: string;
    targetUserId: string;
    offer: RTCSessionDescriptionInit;
  }) => void;
  /** SDP answer relayed to a specific peer by userId. */
  "voice:answer": (data: {
    workspaceId: string;
    targetUserId: string;
    answer: RTCSessionDescriptionInit;
  }) => void;
  /** ICE candidate relayed to a specific peer by userId. */
  "voice:ice-candidate": (data: {
    workspaceId: string;
    targetUserId: string;
    candidate: RTCIceCandidateInit;
  }) => void;
  /** Broadcast local mic mute state to the room. */
  "voice:mute-state": (data: { workspaceId: string; isMuted: boolean }) => void;
};

/**
 * Events emitted by the API server and consumed by the client.
 *
 * Grouped by feature area: chat/presence, canvas, markdown docs, and voice.
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

  // ── Voice ──
  "voice:user-joined": (data: { userId: string; name: string }) => void;
  "voice:user-left": (data: { userId: string }) => void;
  /** Snapshot of current voice participants (from Redis voice presence). */
  "voice:current-users": (data: { users: VoiceUser[] }) => void;
  /** Relayed SDP offer from a peer. */
  "voice:offer": (data: {
    fromUserId: string;
    offer: RTCSessionDescriptionInit;
  }) => void;
  /** Relayed SDP answer from a peer. */
  "voice:answer": (data: {
    fromUserId: string;
    answer: RTCSessionDescriptionInit;
  }) => void;
  /** Relayed ICE candidate from a peer. */
  "voice:ice-candidate": (data: {
    fromUserId: string;
    candidate: RTCIceCandidateInit;
  }) => void;
  /** A peer's mic mute state changed. */
  "voice:mute-state": (data: { userId: string; isMuted: boolean }) => void;
};
