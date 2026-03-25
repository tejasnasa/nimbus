"use client";

import Button from "@nimbus/ui/Button";
import AlertDialog from "@nimbus/ui/AlertDialog";
import Input from "@nimbus/ui/Input";
import Textarea from "@nimbus/ui/Textarea";

export default function CreateWorkspaceCard() {
  const { register, firstError, isSubmitting, onSubmit } = useWorkspaceJoinForm();

  return (
    <div className="w-[calc(48%+16px)] p-6 bg-(--card) rounded-lg flex flex-col justify-between text-center">
      <div>
        <h2 className="text-3xl font-semibold m-4">Create New Workspace</h2>
        <p className="text-sm text-(--muted-foreground) text-center mb-4">
          Organise your docs, team, and projects in one place
        </p>
      </div>

      <div className="flex flex-col">
        <AlertDialog
          trigger={
            <Button className="hover:cursor-pointer my-1 w-full" size="lg">
              + Create Workspace
            </Button>
          }
        >
          <div className=" relative z-50 w-150 rounded-xl border border-(--border) bg-(--card) p-3 shadow-lg animate-in fade-in zoom-in-95">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-(--foreground) m-4">
                Create Workspace
              </h2>
            </div>
            <form onSubmit={onSubmit}>
              <div className="flex flex-col text-left m-4">
                <label htmlFor="title" className="m-1 text-sm">
                  Title
                </label>
                <Input
                  placeholder="Tejas's Workspace"
                  id="title"
                  className="w-full"
                  {...register("name")}
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
                  {...register("description")}
                />
              </div>

              {firstError && (
                <span className="text-xs text-red-500 self-start ml-0.5">
                  {firstError}
                </span>
              )}

              <div className="m-4 flex justify-end gap-2">
                <Button
                  data-alert-dialog-close
                  className="bg-transparent hover:bg-white/10 border border-(--border) hover:border-white/10 hover:cursor-pointer"
                  size="sm"
                >
                  Cancel
                </Button>

                <Button
                  size="sm"
                  className="hover:cursor-pointer"
                  loading={isSubmitting}
                >
                  Continue
                </Button>
              </div>
            </form>
          </div>
        </AlertDialog>

        <AlertDialog
          trigger={
            <button className="text-(--muted-foreground) text-sm hover:underline w-fit mx-auto hover:cursor-pointer">
              or join one
            </button>
          }
        >
          <div className=" relative z-50 w-120 rounded-xl border border-(--border) bg-(--card) p-3 shadow-lg animate-in fade-in zoom-in-95">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-(--foreground) m-4">
                Join Workspace
              </h2>
            </div>
            <form onSubmit={onSubmit}>
              <div className="flex flex-col text-left m-4">
                <Input
                  placeholder="Invite Code"
                  id="inviteCode"
                  className="w-4/5 mx-auto text-center my-4"
                  {...register("inviteCode")}
                ></Input>
              </div>

              {firstError && (
                <span className="text-xs text-red-500 self-start ml-0.5">
                  {firstError}
                </span>
              )}

              <div className="m-4 flex justify-end gap-2">
                <Button
                  data-alert-dialog-close
                  className="bg-transparent hover:bg-white/10 border border-(--border) hover:border-white/10 hover:cursor-pointer"
                  size="sm"
                >
                  Cancel
                </Button>

                <Button
                  size="sm"
                  className="hover:cursor-pointer"
                  loading={isSubmitting}
                >
                  Continue
                </Button>
              </div>
            </form>
          </div>
        </AlertDialog>
      </div>
    </div>
  );
}
