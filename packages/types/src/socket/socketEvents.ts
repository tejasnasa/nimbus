import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { Message } from "../api/message";
import type { VoiceUser } from "./voice";

export type ClientToServerEvents = {
  "workspace:join": (workspaceId: string) => void;
  "workspace:leave": (workspaceId: string) => void;
  "message:send": (data: { workspaceId: string; content: string }) => void;
  "typing:start": (workspaceId: string) => void;
  "typing:stop": (workspaceId: string) => void;
  "canvas:join": (canvasId: string) => void;
  "canvas:leave": (canvasId: string) => void;
  "canvas:update": (data: {
    documentId: string;
    elements: readonly OrderedExcalidrawElement[];
  }) => void;
  "doc:join": (docId: string) => void;
  "doc:update": (docId: string, update: number[]) => void;
  "doc:leave": (docId: string) => void;
  "voice:join": (workspaceId: string) => void;
  "voice:leave": (workspaceId: string) => void;
  "voice:offer": (data: {
    workspaceId: string;
    targetUserId: string;
    offer: RTCSessionDescriptionInit;
  }) => void;
  "voice:answer": (data: {
    workspaceId: string;
    targetUserId: string;
    answer: RTCSessionDescriptionInit;
  }) => void;
  "voice:ice-candidate": (data: {
    workspaceId: string;
    targetUserId: string;
    candidate: RTCIceCandidateInit;
  }) => void;
  "voice:mute-state": (data: { workspaceId: string; isMuted: boolean }) => void;
};

export type ServerToClientEvents = {
  "message:new": (message: Message) => void;
  "presence:joined": (data: { userId: string; name: string }) => void;
  "presence:left": (data: { userId: string }) => void;
  "presence:online_users": (userIds: string[]) => void;
  "typing:start": (data: { userId: string; name: string }) => void;
  "typing:stop": (data: { userId: string; name: string }) => void;
  "canvas:state": (data: {
    documentId: string;
    elements: readonly OrderedExcalidrawElement[];
  }) => void;
  "canvas:update": (data: {
    documentId: string;
    elements: readonly OrderedExcalidrawElement[];
  }) => void;
  "canvas:error": (message: string) => void;
  "doc:state": (update: number[]) => void;
  "doc:update": (update: number[]) => void;
  "doc:error": (message: string) => void;
  "voice:user-joined": (data: { userId: string; name: string }) => void;
  "voice:user-left": (data: { userId: string }) => void;
  "voice:current-users": (data: { users: VoiceUser[] }) => void;
  "voice:offer": (data: {
    fromUserId: string;
    offer: RTCSessionDescriptionInit;
  }) => void;
  "voice:answer": (data: {
    fromUserId: string;
    answer: RTCSessionDescriptionInit;
  }) => void;
  "voice:ice-candidate": (data: {
    fromUserId: string;
    candidate: RTCIceCandidateInit;
  }) => void;
  "voice:mute-state": (data: { userId: string; isMuted: boolean }) => void;
};
