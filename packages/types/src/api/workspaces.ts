export type Member = {
  id: string;
  image: string | null;
  role: string;
  online?: boolean;
};

export type Workspace = {
  id: string;
  name: string;
  description: string;
  slug: string;
  slugId: number;
  inviteCode: string;
  updatedAt: string;
  members: Member[];
};
