export type Member = {
  id: string;
  image: string | null;
  online?: boolean;
};

export type Workspace = {
  id: string;
  name: string;
  description: string;
  slug: string;
  slugId: number;
  updatedAt: string;
  members: Member[];
};
