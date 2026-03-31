import UserNavbar from "../../components/UserNavbar";
import { authClient } from "../../lib/auth-client";
import { headers } from "next/headers";
import { deleteWorkspace, getWorkspaces } from "../../api/workspace";
import ViewWorkspaces from "../../components/ViewWorkspaces";

export default async function Home() {
  const { data: session } = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  const workspaces = await getWorkspaces();

  return (
    <main className="min-h-dvh bg-(--background) text-(--foreground) relative">
      <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
      <div className="absolute top-0 right-0 w-125 h-125 bg-(--primary)/8 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-100 h-100 bg-(--sidebar-primary)/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10">
        <UserNavbar
          id={session!.user.id}
          avatar={session!.user.image}
          name={session!.user.name}
        />

        <div className="max-w-350 mx-auto px-8 pt-12 pb-20">
          <div className="mb-12 animate-slide-up">
            <h1 className="text-6xl font-bold tracking-tight mb-3">
              Workspaces
            </h1>
            <p className="text-lg text-(--muted-foreground)">
              Manage your projects and collaborate with your team
            </p>
          </div>

          <div className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
            <ViewWorkspaces
              workspaces={workspaces}
              id={session!.user.id}
              deleteWorkspace={deleteWorkspace}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
