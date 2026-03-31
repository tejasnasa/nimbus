"use client";

import Navbar from "@nimbus/ui/Navbar";
import { authClient } from "../lib/auth-client";
import { useRouter } from "next/navigation";

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

  return <Navbar logout={handleLogout} id={id} avatar={avatar} name={name} />;
}
