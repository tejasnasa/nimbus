"use client";

import Button from "@nimbus/ui/Button";
import AlertDialog from "@nimbus/ui/AlertDialog";
import Input from "@nimbus/ui/Input";
import Textarea from "@nimbus/ui/Textarea";

export default function CreateWorkspaceCard() {
  return (
    <div className="w-[48.5%] p-6 bg-(--card) rounded-lg flex flex-col justify-between text-center py-10">
      <div>
        <h2 className="text-3xl font-semibold m-4">Create New Workspace</h2>
        <p className="text-sm text-(--muted-foreground) text-center">
          Organise your docs, team, and projects in one place
        </p>
      </div>

      <AlertDialog
        trigger={
          <Button className="hover:cursor-pointer m-2" size="lg">
            + Create Workspace
          </Button>
        }
      >
        <div className=" relative z-50 w-150 rounded-xl border border-(--border) bg-(--card) p-3 shadow-lg animate-in fade-in zoom-in-95 ">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-(--foreground) m-4">
              Create Workspace
            </h2>
          </div>
          <form action="">
            <div className="flex flex-col text-left m-4">
              <label htmlFor="title" className="m-1 text-sm">
                Title
              </label>
              <Input
                placeholder="Tejas's Workspace"
                id="title"
                className="w-full"
              ></Input>
            </div>
            <div className="flex flex-col text-left m-4">
              <label htmlFor="description" className="m-1 text-sm">
                Description
              </label>
              <Textarea
                placeholder="Describe your workspace..."
                id="description"
                className="w-full"
              ></Textarea>
            </div>

            <div className="m-4 flex justify-end gap-2">
              <Button
                data-alert-dialog-close
                type="button"
                className="bg-transparent hover:bg-white/10 border border-(--border) hover:border-white/10 hover:cursor-pointer"
                size="sm"
              >
                Cancel
              </Button>

              <Button
                data-alert-dialog-close
                type="button"
                size="sm"
                className="hover:cursor-pointer"
              >
                Continue
              </Button>
            </div>
          </form>
        </div>
      </AlertDialog>
    </div>
  );
}
