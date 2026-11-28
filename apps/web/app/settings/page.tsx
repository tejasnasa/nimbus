/**
 * @module web/app/settings/page
 * @description Account-level settings (server component): resolves the
 * session, `redirect("/login")` defensively (the proxy is the UX guard,
 * the API is the real one), then renders `UserNavbar` and the client
 * `<AccountSettings />`. The caller's free AI allowances are fetched on the
 * server and passed down so the Free usage tab is answerable before its own
 * fetch lands.
 * Guarded by `proxy.ts`.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import AccountSettings from "../../components/AccountSettings";
import UserNavbar from "../../components/UserNavbar";
import { authClient } from "../../lib/auth-client";
import { getFreeUsage } from "../../api/ai";

export default async function SettingsPage() {
  const { data: session } = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  if (!session) {
    redirect("/login");
  }

  // Fetched alongside session so the Free usage tab has a payload to render
  // before its own hook fires. Failure falls back to an "unconfigured" shape
  // inside `getFreeUsage`; the page itself never sees an error.
  const initialFreeUsage = await getFreeUsage();

  return (
    <div className="min-h-dvh bg-(--background) font-sans text-(--foreground)">
      <UserNavbar
        id={session.user.id}
        avatar={session.user.image}
        name={session.user.name}
        backLink={{ href: "/home", label: "← Back to workspaces" }}
      />

      <main className="mx-auto max-w-7xl px-5 pt-11 pb-20 sm:px-10">
        <AccountSettings
          user={{
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
          }}
          initialFreeUsage={initialFreeUsage}
        />
      </main>
    </div>
  );
}
