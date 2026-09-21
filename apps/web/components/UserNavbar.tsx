/**
 * @module web/components/UserNavbar
 * @description Authenticated navbar wiring: adapts `authClient.signOut` to
 * the UI `Navbar`'s `logout` prop and routes to `/login` (even on failure).
 * The Settings menu item navigates to `/settings`.
 */
"use client";

import Navbar from "@nimbus/ui/Navbar";
import { authClient } from "../lib/auth-client";
import { useRouter } from "next/navigation";

/**
 * @param props.id - User ID (fallback avatar hash).
 * @param props.avatar - Custom avatar URL (nullable).
 * @param props.name - Display name in the menu header.
 */
export default function UserNavbar({
  id,
  avatar,
  name,
}: {
  id: string;
  avatar?: string | null;
  name: string;
}) {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push("/login");
          },
        },
      });
    } catch (error) {
      console.error("Sign out failed", error);
      router.push("/login");
    }
  };

  const handleSettings = () => {
    router.push("/settings");
  };

  return (
    <Navbar
      logout={handleLogout}
      onSettings={handleSettings}
      id={id}
      avatar={avatar}
      name={name}
    />
  );
}
