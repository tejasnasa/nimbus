/**
 * @module web/lib/auth-client
 * @description Browser better-auth client pointed at the API backend
 * (`NEXT_PUBLIC_BACKEND_URL`). Used by login/signup forms and
 * `logoutAction`.
 */
import { plugins } from "@milkdown/kit/preset/commonmark";
import { createAuthClient } from "better-auth/react";

/** Shared browser auth client (sign-in/up/out, session hooks). */
export const authClient: ReturnType<typeof createAuthClient> = createAuthClient(
  {
    baseURL: `${process.env.NEXT_PUBLIC_BACKEND_URL}`
  },
);
