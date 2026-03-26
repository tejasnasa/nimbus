import Settings from "@nimbus/ui/icons/Settings";
import Chat from "@nimbus/ui/Chat";
import DocEditor from "../../../components/DocEditor";
import AlertDialog from "@nimbus/ui/AlertDialog";
import WorkspaceSettings from "@nimbus/ui/WorkspaceSettings";

export default async function Workspace() {

  return (
    <main className="h-dvh flex">
      <section className="w-[25%] p-4 flex flex-col min-h-0 overflow-hidden">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-4xl">SIH Project</h1>
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
          Workspace for SIH 2025 project collaboration
        </div>
        <Chat />
      </section>
      <DocEditor />
    </main>
  );
}
