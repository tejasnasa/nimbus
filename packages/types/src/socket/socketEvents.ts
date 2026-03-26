import { Message } from "../api/message";

export type ClientToServerEvents = {
  "workspace:join": (workspaceId: string) => void;
  "workspace:leave": (workspaceId: string) => void;
  "message:send": (data: { workspaceId: string; content: string }) => void;
  "typing:start": (workspaceId: string) => void;
  "typing:stop": (workspaceId: string) => void;
}

export type ServerToClientEvents = {
  "message:new": (message: Message) => void;
  "presence:joined": (data: { userId: string; name: string }) => void;
  "presence:left": (data: { userId: string }) => void;
  "presence:online_users": (userIds: string[]) => void;
  "typing:start": (data: { userId: string; name: string }) => void;
  "typing:stop": (data: { userId: string; name: string }) => void;
}
