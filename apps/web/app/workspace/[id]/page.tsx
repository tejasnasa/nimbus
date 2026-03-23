import Settings from "@nimbus/ui/icons/Settings";
import Chat from "@nimbus/ui/Chat";
import DocTabs from "@nimbus/ui/DocTabs";
import DocEditor from "../../../components/DocEditor";

export default function Workspace() {
  return (
    <main className="h-dvh flex">
      <section className="w-[25%] p-4 flex flex-col min-h-0 overflow-hidden">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-4xl">SIH Project</h1>
          <button className="w-5 h-5 m-2">
            <Settings />
          </button>
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
