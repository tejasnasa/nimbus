import UserNavbar from "../../components/UserNavbar";
import { authClient } from "../../lib/auth-client";
import { headers } from "next/headers";
import { deleteWorkspace, getWorkspaces } from "../../api/workspace";
import ViewWorkspaces from "../../components/ViewWorkspaces";

export default async function Home() {
  const { data: session} = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  const workspaces = await getWorkspaces();

  return (
    <main className="min-h-dvh mb-10">
      <UserNavbar
        id={session!.user.id}
        avatar={session!.user.image}
        name={session!.user.name}
      />
      <h1 className="mx-28 mb-12 mt-28 text-8xl font-semibold">Workspaces</h1>

      <ViewWorkspaces
        workspaces={workspaces}
        id={session!.user.id}
        deleteWorkspace={deleteWorkspace}
      />
    </main>
  );
}
