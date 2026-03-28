import Settings from "@nimbus/ui/icons/Settings";
import Chat from "../../../components/Chat";
import DocEditor from "../../../components/DocEditor";
import { getWorkspace } from "../../../api/workspace";
import AlertDialog from "@nimbus/ui/AlertDialog";
import { authClient } from "../../../lib/auth-client";
import { headers } from "next/headers";
import { getMessages } from "../../../api/message";
import { getDocuments } from "../../../api/document";
import WorkspaceSettings from "../../../components/WorkspaceSettings";

export default async function Workspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspaceData = await getWorkspace(id);
  const messages = await getMessages(workspaceData.id);
  const documents = await getDocuments(workspaceData.id);
  const { data: session } = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  return (
    <main className="h-dvh flex">
      <section className="w-[25%] p-4 flex flex-col min-h-0 overflow-hidden border-r border-(--border)">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-4xl">{workspaceData.name}</h1>
          <AlertDialog
            trigger={
              <button className="p-1.5 w-9 h-9 hover:cursor-pointer text-(--muted-foreground) rounded-md hover:bg-(--muted) transition-colors">
                <Settings />
              </button>
            }
          >
            <WorkspaceSettings
              workspace={workspaceData}
              documents={documents}
            />
          </AlertDialog>
        </div>
        <div className="text-sm text-(--muted-foreground) mb-2">
          {workspaceData.description}
        </div>
        <Chat
          userId={session!.user?.id}
          messages={messages}
          wsid={workspaceData.id}
        />
      </section>
      <DocEditor documents={documents} />
    </main>
  );
}
