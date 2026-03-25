import Navbar from "@nimbus/ui/Navbar";
import WorkspaceCard from "@nimbus/ui/WorkspaceCard";
import CreateWorkspaceCard from "../../components/CreateWorkspaceCard";
import ToggleGroup from "@nimbus/ui/ToggleGroup";
import { authClient } from "../../lib/auth-client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { logoutAction } from "../../actions/auth";
import { getWorkspaces } from "../../api/workspace";

export default async function Home() {
  const workspaces = await getWorkspaces();
  console.log(workspaces);
  const { data: session, error } = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  if (error || !session) {
    redirect("/login");
  }

  return (
    <main className="min-h-dvh">
      <Navbar
        logout={logoutAction}
        id={session.user.id}
        avatar={session.user.image}
        name={session.user.name}
      />
      <h1 className="mx-28 mb-12 mt-28 text-8xl font-semibold">Workspaces</h1>
      <ToggleGroup options={["All Workspaces", "My Workspaces"]} />
      <section className="mx-28 flex flex-wrap gap-5">
        <CreateWorkspaceCard />
        {workspaces.map((ws) => (
          <WorkspaceCard key={ws.id} workspace={ws} />
        ))}
      </section>
    </main>
  );
}
