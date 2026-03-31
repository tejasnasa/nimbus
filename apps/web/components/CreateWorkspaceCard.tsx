"use client";

import Button from "@nimbus/ui/Button";
import AlertDialog from "@nimbus/ui/AlertDialog";
import Input from "@nimbus/ui/Input";
import Textarea from "@nimbus/ui/Textarea";
import { useWorkspaceForm } from "../hooks/useWorkspaceForm";
import { useWorkspaceJoinForm } from "../hooks/useWorkspaceJoinForm";
import Plus from "@nimbus/ui/icons/Plus";
import Error from "@nimbus/ui/icons/Error";
import Signup from "@nimbus/ui/icons/Signup";

export default function CreateWorkspaceCard() {
  const {
    register: creationRegister,
    firstError: creationFirstError,
    isSubmitting: creationIsSubmitting,
    onSubmit: creationOnSubmit,
  } = useWorkspaceForm();
  const {
    register: joinRegister,
    firstError: joinFirstError,
    isSubmitting: joinIsSubmitting,
    onSubmit: joinOnSubmit,
  } = useWorkspaceJoinForm();

  return (
    <div className="group p-6 rounded-2xl border-4 border-dotted border-(--border) bg-(--card)/40 backdrop-blur-sm flex flex-col justify-between text-center hover:border-(--primary)/50 hover:bg-(--card)/40 transition-all duration-300">
      <div className="flex-1 flex flex-col items-center justify-center py-6">
        <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-(--primary)/20 to-(--sidebar-primary)/20 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
          <Plus className="w-7 h-7 text-(--primary-foreground)" />
        </div>
        <h2 className="text-xl font-semibold mb-2 tracking-tight">
          New Workspace
        </h2>
        <p className="text-sm text-(--muted-foreground) leading-relaxed max-w-50">
          Organise your docs, team, and projects
        </p>
      </div>

      <div className="flex flex-col gap-2 mt-4">
        <AlertDialog
          trigger={
            <Button
              className="hover:cursor-pointer w-full rounded-xl"
              size="md"
            >
              Create Workspace
            </Button>
          }
        >
          <div className="relative z-50 w-120 rounded-2xl border border-(--border) bg-(--card) p-6 shadow-2xl shadow-(--primary)/10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-linear-to-br from-(--primary) to-(--sidebar-primary) flex items-center justify-center shrink-0">
                <Plus className="w-5 h-5 text-(--primary-foreground)" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Create Workspace</h2>
                <p className="text-xs text-(--muted-foreground)">
                  Set up a new space for your team
                </p>
              </div>
            </div>
            <form onSubmit={creationOnSubmit}>
              <div className="flex flex-col gap-2 mb-4">
                <label
                  htmlFor="title"
                  className="text-sm font-medium text-(--muted-foreground)"
                >
                  Title
                </label>
                <Input
                  placeholder="Tejas's Workspace"
                  id="title"
                  className="w-full"
                  {...creationRegister("name")}
                />
              </div>
              <div className="flex flex-col gap-2 mb-4">
                <label
                  htmlFor="description"
                  className="text-sm font-medium text-(--muted-foreground)"
                >
                  Description
                </label>
                <Textarea
                  placeholder="Describe your workspace..."
                  id="description"
                  className="w-full"
                  {...creationRegister("description")}
                />
              </div>

              {creationFirstError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20 mb-4">
                  <Error className="w-4 h-4 text-(--destructive) shrink-0" />
                  <span className="text-xs text-(--destructive)">
                    {creationFirstError}
                  </span>
                </div>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <Button
                  data-alert-dialog-close
                  className="bg-transparent hover:bg-(--muted) border border-(--border) text-(--foreground) hover:cursor-pointer rounded-xl"
                  size="sm"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="hover:cursor-pointer rounded-xl"
                  loading={creationIsSubmitting}
                >
                  Create
                </Button>
              </div>
            </form>
          </div>
        </AlertDialog>

        <AlertDialog
          trigger={
            <button className="text-(--muted-foreground) text-sm hover:underline transition-colors hover:cursor-pointer mx-auto">
              or join with invite code
            </button>
          }
        >
          <div className="relative z-50 w-100 rounded-2xl border border-(--border) bg-(--card) p-6 shadow-2xl shadow-(--primary)/10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-linear-to-br from-(--chart-2) to-(--primary) flex items-center justify-center shrink-0">
                <Signup className="w-5 h-5 text-(--primary-foreground)" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Join Workspace</h2>
                <p className="text-xs text-(--muted-foreground)">
                  Enter the invite code to join
                </p>
              </div>
            </div>
            <form onSubmit={joinOnSubmit}>
              <Input
                placeholder="Paste invite code here"
                id="inviteCode"
                className="w-full text-center tracking-wider my-2"
                {...joinRegister("inviteCode")}
              />

              {joinFirstError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20 mt-3">
                  <Error className="w-4 h-4 text-(--destructive) shrink-0" />
                  <span className="text-xs text-(--destructive)">
                    {joinFirstError}
                  </span>
                </div>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <Button
                  data-alert-dialog-close
                  className="bg-transparent hover:bg-(--muted) border border-(--border) text-(--foreground) hover:cursor-pointer rounded-xl"
                  size="sm"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="hover:cursor-pointer rounded-xl"
                  loading={joinIsSubmitting}
                >
                  Join
                </Button>
              </div>
            </form>
          </div>
        </AlertDialog>
      </div>
    </div>
  );
}
