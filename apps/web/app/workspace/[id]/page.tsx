import Settings from "@nimbus/ui/icons/Settings";
import Chat from "../../../components/Chat";
import DocEditor from "../../../components/DocEditor";
import { getWorkspace } from "../../../api/workspace";
import AlertDialog from "@nimbus/ui/AlertDialog";
import WorkspaceSettings from "@nimbus/ui/WorkspaceSettings";
import { authClient } from "../../../lib/auth-client";
import { headers } from "next/headers";
import { getMessages } from "../../../api/message";

export default async function Workspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getWorkspace(id);
  const messages = await getMessages(data.id);
  const { data: session } = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  return (
    <main className="h-dvh flex">
      <section className="w-[25%] p-4 flex flex-col min-h-0 overflow-hidden border-r border-(--border) border-solid">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-4xl">{data.name}</h1>
          <AlertDialog
            trigger={
              <button className="p-1.5 w-9 h-9 hover:cursor-pointer text-(--muted-foreground) rounded-md hover:bg-(--muted) transition-colors">
                <Settings />
              </button>
            }
          >
            <WorkspaceSettings />
          </AlertDialog>
        </div>
        <div className="text-sm text-(--muted-foreground) mb-2">
          {data.description}
        </div>
        <Chat userId={session!.user?.id} messages={messages} wsid={data.id} />
      </section>
      <DocEditor />
    </main>
  );
}
