"use server";

import { redirect } from "next/navigation";
import { authClient } from "../lib/auth-client";

export async function logoutAction() {
  await authClient.signOut();
  redirect("/login");
}
