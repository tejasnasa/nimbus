/** Workspace member DTO used for member lists and presence UIs. */
export type Member = {
  id: string;
  name: string;
  image: string | null;
  /** RBAC role string — one of OWNER / ADMIN / MEMBER. */
  role: string;
  /** Set live by the client based on Redis chat presence; not from REST. */
  online?: boolean;
};

/** Workspace summary DTO returned by REST endpoints and rendered on the dashboard. */
export type Workspace = {
  id: string;
  name: string;
  description: string;
  slug: string;
  /** Auto-increment integer used in the `/workspace/[id]` route param. */
  slugId: number;
  inviteCode: string;
  updatedAt: string;
  members: Member[];
};
