/**
 * @module web/app/settings/page
 * @description Account-level settings (server component): resolves the
 * session, `redirect("/login")` defensively (the proxy is the UX guard,
 * the API is the real one), then renders `UserNavbar` and the client
 * `<AccountSettings />`. Guarded by `proxy.ts`.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import AccountSettings from "../../components/AccountSettings";
import UserNavbar from "../../components/UserNavbar";
import { authClient } from "../../lib/auth-client";

export default async function SettingsPage() {
  const { data: session } = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="min-h-dvh bg-(--background) text-(--foreground) relative">
      <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
      <div className="absolute top-0 right-0 w-125 h-125 bg-(--primary)/8 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-100 h-100 bg-(--sidebar-primary)/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10">
        <UserNavbar
          id={session.user.id}
          avatar={session.user.image}
          name={session.user.name}
        />

        <div className="max-w-350 mx-auto px-8 pt-12 pb-20">
          <div className="mb-12 animate-slide-up">
            <h1 className="text-6xl font-bold tracking-tight mb-3">
              Account Settings
            </h1>
            <p className="text-lg text-(--muted-foreground)">
              Manage your profile, password and active sessions
            </p>
          </div>

          <div className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
            <AccountSettings
              user={{
                id: session.user.id,
                name: session.user.name,
                image: session.user.image,
              }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
