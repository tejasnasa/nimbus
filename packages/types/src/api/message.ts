export type Message = {
  id: string;
  content: string;
  userId: string;
  workspaceId: string;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    image: string | null;
  };
};
