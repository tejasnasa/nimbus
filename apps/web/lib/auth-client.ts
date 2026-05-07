import { plugins } from "@milkdown/kit/preset/commonmark";
import { createAuthClient } from "better-auth/react";
import { sentinelClient } from "@better-auth/infra/client";

export const authClient: ReturnType<typeof createAuthClient> = createAuthClient(
  {
    baseURL: `${process.env.NEXT_PUBLIC_BACKEND_URL}`,
    plugins: [
      sentinelClient()
    ]
  },
);
