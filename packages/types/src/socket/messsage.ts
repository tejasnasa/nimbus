export interface SocketMessage {
  id: string;
  content: string;
  userId: string;
  workspaceId: string;
  createdAt: Date;
  name: string;
  image?: string;
}
