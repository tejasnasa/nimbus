import Navbar from "@nimbus/ui/Navbar";
import ToggleGroup from "@nimbus/ui/ToggleGroup";
import { authClient } from "../../lib/auth-client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { logoutAction } from "../../actions/auth";
import { deleteWorkspace, getWorkspaces } from "../../api/workspace";
import ViewWorkspaces from "../../components/ViewWorkspaces";

export default async function Home() {
  const { data: session, error } = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  const workspaces = await getWorkspaces();

  return (
    <main className="min-h-dvh mb-10">
      <Navbar
        logout={logoutAction}
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
