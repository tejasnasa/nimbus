/**
 * @module web/app/home/page
 * @description Authenticated dashboard (server component): resolves the
 * session, loads workspaces server-side, and renders `UserNavbar` +
 * `ViewWorkspaces` (delete wired to the server action). Guarded by `proxy.ts`.
 */
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
    <div className="min-h-dvh bg-(--background) font-sans text-(--foreground)">
      <UserNavbar
        id={session!.user.id}
        avatar={session!.user.image}
        name={session!.user.name}
      />

      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-5 pt-12 pb-20 sm:px-10">
        <ViewWorkspaces
          workspaces={workspaces}
          id={session!.user.id}
          deleteWorkspace={deleteWorkspace}
          firstName={session!.user.name.split(" ")[0]}
        />
      </main>
    </div>
  );
}
