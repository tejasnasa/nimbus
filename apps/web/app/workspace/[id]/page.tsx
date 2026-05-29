import Cloud from "@nimbus/ui/icons/Cloud";
import { headers } from "next/headers";
import Link from "next/link";
import { getDocuments } from "../../../api/document";
import { getMessages } from "../../../api/message";
import { getWorkspace } from "../../../api/workspace";
import Chat from "../../../components/Chat";
import DocEditor from "../../../components/DocEditor";
import VoiceOverlay from "../../../components/VoiceOverlay";
import { authClient } from "../../../lib/auth-client";
import { VoiceProvider } from "../../../providers/VoiceProvider";

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
    <VoiceProvider
      userId={session!.user.id}
      userName={session!.user.name}
      userImage={session!.user.image ?? null}
      workspaceId={workspaceData.id}
    >
      <main className="h-dvh flex bg-(--background) text-(--foreground) overflow-hidden relative">
        <VoiceOverlay />
        <section className="w-90 flex flex-col min-h-0 overflow-hidden border-r border-(--border) bg-(--card)/20 backdrop-blur-sm">
          <div className="flex justify-between items-center p-4 pb-2">
            <div className="flex items-start gap-2">
              <Link
                href="/"
                className="flex items-center font-semibold text-lg group"
              >
                <div className="flex size-9 items-center justify-center rounded-lg text-(--primary-foreground) group-hover:scale-110 transition-transform duration-300">
                  <Cloud />
                </div>
              </Link>
              <h1 className="text-2xl ml-2 font-semibold tracking-tight">
                {workspaceData.name}
              </h1>
            </div>
          </div>
          <div className="text-xs text-(--muted-foreground) px-4 pb-3 leading-relaxed">
            {workspaceData.description}
          </div>
          <div className="flex-1 min-h-0 px-2 pb-2">
            <Chat
              userId={session!.user?.id}
              messages={messages}
              wsid={workspaceData.id}
              documents={documents}
              workspaceData={workspaceData}
            />
          </div>
        </section>
        <DocEditor documents={documents} />
      </main>
    </VoiceProvider>
  );
}
