import { createAuthClient } from "better-auth/react";

export const authClient: ReturnType<typeof createAuthClient> = createAuthClient(
  {
    baseURL: `${process.env.BACKEND_URL}`,
  },
);
