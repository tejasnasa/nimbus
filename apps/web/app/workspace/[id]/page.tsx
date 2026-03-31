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
  console.log(workspaceData);
  const messages = await getMessages(workspaceData.id);
  const documents = await getDocuments(workspaceData.id);
  const { data: session } = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  return (
    <main className="h-dvh flex bg-(--background) text-(--foreground) overflow-hidden">
      <section className="w-90 flex flex-col min-h-0 overflow-hidden border-r border-(--border) bg-(--card)/20 backdrop-blur-sm">
        <div className="flex justify-between items-center p-4 pb-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {workspaceData.name}
          </h1>
          <AlertDialog
            trigger={
              <button className="p-2 w-9 h-9 hover:cursor-pointer text-(--muted-foreground) rounded-lg hover:bg-(--muted) transition-all duration-200 hover:text-(--foreground) shrink-0">
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
        <div className="text-xs text-(--muted-foreground) px-4 pb-3 leading-relaxed">
          {workspaceData.description}
        </div>
        <div className="flex-1 min-h-0 px-2 pb-2">
          <Chat
            userId={session!.user?.id}
            messages={messages}
            wsid={workspaceData.id}
          />
        </div>
      </section>
      <DocEditor documents={documents} />
    </main>
  );
}
