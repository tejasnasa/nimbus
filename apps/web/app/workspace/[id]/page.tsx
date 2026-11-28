import Logo from "@nimbus/ui/Logo";
import { headers } from "next/headers";
import Link from "next/link";
import { getAiStatus } from "../../../api/ai";
import { getDocuments } from "../../../api/document";
import { getMessages } from "../../../api/message";
import { getVoiceRoster } from "../../../api/voice";
import { getWorkspace } from "../../../api/workspace";
import Chat from "../../../components/Chat";
import DocEditor from "../../../components/DocEditor";
import { DocEditorRefProvider } from "../../../components/DocEditorRefContext";
import VoiceDock from "../../../components/VoiceDock";
import VoiceOverlay from "../../../components/VoiceOverlay";
import WorkspaceSettingsButton from "../../../components/WorkspaceSettingsButton";
import { WorkspaceSettingsProvider } from "../../../components/WorkspaceSettingsContext";
import { authClient } from "../../../lib/auth-client";
/**
 * @module web/app/workspace/[id]/page
 * @description Workspace room (server component): loads workspace, messages,
 * and documents in parallel-by-await, then composes the two-pane layout —
 * Chat sidebar (logo, workspace name, settings gear, messages) beside `DocEditor` — inside
 * `VoiceProvider` (call room + identity) + `MeetingProvider` (assistant meeting) + `DocEditorRefProvider` (add-tab
 * bridge) + `WorkspaceSettingsProvider` (the one settings dialog, openable on any tab from the gear, the chat banner and the call card), with a global `VoiceOverlay` and the floating `VoiceDock` call card. AI status is fetched alongside so the
 * chat composer renders in the right enabled/disabled state on first paint.
 * Guarded by `proxy.ts`.
 */
import { MeetingProvider } from "../../../providers/MeetingProvider";
import { VoiceProvider } from "../../../providers/VoiceProvider";

/**
 * @param props.params - Route params; `id` is the workspace slugId.
 */
export default async function Workspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspaceData = await getWorkspace(id);
  const messages = await getMessages(workspaceData.id);
  const documents = await getDocuments(workspaceData.id);
  const initialAiStatus = await getAiStatus(workspaceData.id);
  const initialRoster = await getVoiceRoster(workspaceData.id);
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
      initialRoster={initialRoster}
    >
      <MeetingProvider workspaceId={workspaceData.id}>
        <DocEditorRefProvider>
          <WorkspaceSettingsProvider
            workspace={workspaceData}
            documents={documents}
            initialAiStatus={initialAiStatus}
            userId={session!.user.id}
          >
            <main className="h-dvh flex bg-(--background) font-sans text-(--foreground) overflow-hidden relative">
              <VoiceOverlay />
              <VoiceDock />
              <section
                aria-label="Chat"
                className="flex w-90 shrink-0 flex-col min-h-0 overflow-hidden border-r border-(--line-1) bg-(--panel) font-sans"
              >
                <div className="flex justify-between items-center gap-2.5 px-4 pt-4 pb-1.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Link
                      href="/"
                      aria-label="All workspaces"
                      className="flex shrink-0 transition-transform duration-300 hover:scale-110"
                    >
                      <Logo size={30} wordmark={false} />
                    </Link>
                    <h1 className="truncate font-display text-[22px] font-semibold tracking-[-0.02em]">
                      {workspaceData.name}
                    </h1>
                  </div>
                  <WorkspaceSettingsButton />
                </div>
                <p className="px-4 pb-3.5 text-[13px] leading-normal text-(--muted-foreground)">
                  {workspaceData.description}
                </p>
                <div className="flex-1 min-h-0">
                  <Chat
                    userId={session!.user?.id}
                    messages={messages}
                    wsid={workspaceData.id}
                    initialAiStatus={initialAiStatus}
                  />
                </div>
              </section>
              <DocEditor
                documents={documents}
                user={{
                  id: session!.user.id,
                  name: session!.user.name,
                  image: session!.user.image ?? null,
                }}
              />
            </main>
          </WorkspaceSettingsProvider>
        </DocEditorRefProvider>
      </MeetingProvider>
    </VoiceProvider>
  );
}
