import AlertDialog from "@nimbus/ui/AlertDialog";
import Settings from "@nimbus/ui/icons/Settings";
import WorkspaceSettings from "@nimbus/ui/WorkspaceSettings";
import { getWorkspace } from "../api/workspace";

export default async function WorkspaceData({ id }: { id: string }) {
  console.log(id);
  const data = await getWorkspace(id);

  return (
    <>
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
    </>
  );
}
