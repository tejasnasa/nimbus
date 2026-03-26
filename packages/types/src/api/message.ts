export type Message = {
  id: string;
  content: string;
  userId: string;
  workspaceId: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    image: string | null;
		isOnline?: boolean;
  };
};
