import Settings from "@nimbus/ui/icons/Settings";
import Chat from "@nimbus/ui/Chat";
import DocEditor from "../../../components/DocEditor";
import WorkspaceData from "../../../components/WorkspaceData";

export default async function Workspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="h-dvh flex">
      <section className="w-[25%] p-4 flex flex-col min-h-0 overflow-hidden">
        <WorkspaceData id={id} />
        <Chat />
      </section>
      <DocEditor />
    </main>
  );
}
