import { Message } from "../api/message";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

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
};
