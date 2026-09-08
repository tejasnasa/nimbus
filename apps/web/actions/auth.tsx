/**
 * @module web/actions/auth
 * @description Auth Server Actions (currently sign-out only).
 */
"use server";

import { redirect } from "next/navigation";
import { authClient } from "../lib/auth-client";

/** Signs out via the browser auth client, then routes to `/login`. */
export async function logoutAction() {
  await authClient.signOut();
  redirect("/login");
}
