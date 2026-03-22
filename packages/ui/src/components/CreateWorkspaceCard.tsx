import Button from "./Button";

export default function CreateWorkspaceCard() {
  return (
    <div className="w-[48.5%] p-6 bg-(--card) rounded-lg flex flex-col justify-between text-center py-10">
      <div>
        <h2 className="text-3xl font-semibold m-4">Create New Workspace</h2>
        <p className="text-sm text-(--muted-foreground) text-center">
          Organise your docs, team, and projects in one place
        </p>
      </div>

      <Button size="lg" className="m-2">
        + Create Workspace
      </Button>
    </div>
  );
}
