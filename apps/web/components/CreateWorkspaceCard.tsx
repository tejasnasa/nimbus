"use client";

import AlertDialog from "@nimbus/ui/AlertDialog";
import { Spinner } from "@nimbus/ui/icons/Spinner";
import { useWorkspaceForm } from "../hooks/useWorkspaceForm";
import { useWorkspaceJoinForm } from "../hooks/useWorkspaceJoinForm";
import { AuthError, authInputClass } from "./AuthParts";
/**
 * @module web/components/CreateWorkspaceCard
 * @description Dashboard "Join with a code" and "New workspace" actions, each
 * opening an `AlertDialog` — create (name/description via `useWorkspaceForm`)
 * and join-by-invite-code (via `useWorkspaceJoinForm`). Rendered in the
 * toolbar of `ViewWorkspaces`.
 */

const secondaryButton =
  "min-h-11 cursor-pointer rounded-xl border border-(--line-3) bg-transparent px-4 text-sm font-medium text-(--foreground) transition-colors hover:bg-(--surface-3) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet)";

const primaryButton =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-(--brand) px-4.5 text-sm font-semibold text-white transition-colors hover:bg-(--brand)/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet) disabled:cursor-default disabled:opacity-60";

const panelClass =
  "relative z-50 flex w-[min(460px,calc(100vw-2rem))] flex-col gap-4.5 rounded-[20px] border border-(--line-3) bg-(--surface-2) p-6.5 font-sans shadow-[0_40px_100px_rgba(0,0,0,0.6)]";

const labelClass = "flex flex-col gap-2 text-[13px] font-medium text-(--text-soft)";

/** Title, supporting line and close button shared by both dialogs. */
function DialogHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        <p className="text-sm text-(--muted-foreground)">{sub}</p>
      </div>
      <button
        type="button"
        data-alert-dialog-close
        aria-label="Close"
        className="size-8.5 shrink-0 cursor-pointer rounded-[9px] bg-(--surface-4) text-lg text-(--text-body) transition-colors hover:text-(--foreground) focus-visible:outline-2 focus-visible:outline-(--violet)"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

/** Cancel / confirm row shared by both dialogs. */
function DialogActions({
  cta,
  loading,
}: {
  cta: string;
  loading: boolean;
}) {
  return (
    <div className="flex justify-end gap-2.5">
      <button type="button" data-alert-dialog-close className={secondaryButton}>
        Cancel
      </button>
      <button type="submit" disabled={loading} className={primaryButton}>
        {loading && <Spinner className="h-4 w-4" />}
        {cta}
      </button>
    </div>
  );
}

/** Toolbar buttons that open the join and create dialogs. */
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
    <>
      <AlertDialog
        trigger={
          <button type="button" className={secondaryButton}>
            Join with a code
          </button>
        }
      >
        <div className={panelClass}>
          <DialogHeader
            title="Join Workspace"
            sub="Ask a workspace admin for its invite code."
          />
          <form onSubmit={joinOnSubmit} className="flex flex-col gap-4.5">
            <label htmlFor="inviteCode" className={labelClass}>
              Invite code
              <input
                id="inviteCode"
                placeholder="Paste invite code here"
                className={`${authInputClass} font-mono`}
                {...joinRegister("inviteCode")}
              />
            </label>
            {joinFirstError && <AuthError message={joinFirstError} />}
            <DialogActions cta="Join workspace" loading={joinIsSubmitting} />
          </form>
        </div>
      </AlertDialog>

      <AlertDialog
        trigger={
          <button type="button" className={primaryButton}>
            <span aria-hidden="true" className="text-lg leading-none">
              +
            </span>
            New workspace
          </button>
        }
      >
        <div className={panelClass}>
          <DialogHeader
            title="Create Workspace"
            sub="A shared room for your team’s docs, boards, chat and calls."
          />
          <form onSubmit={creationOnSubmit} className="flex flex-col gap-4.5">
            <label htmlFor="title" className={labelClass}>
              Name
              <input
                id="title"
                placeholder="Tejas's Workspace"
                className={authInputClass}
                {...creationRegister("name")}
              />
            </label>
            <label htmlFor="description" className={labelClass}>
              Description
              <textarea
                id="description"
                rows={3}
                placeholder="Describe your workspace..."
                className={`${authInputClass} resize-none py-3`}
                {...creationRegister("description")}
              />
            </label>
            <p className="text-[13px] leading-normal text-(--muted-foreground)">
              It starts with a blank doc, a blank whiteboard, and Nimbus as a
              member.
            </p>
            {creationFirstError && <AuthError message={creationFirstError} />}
            <DialogActions
              cta="Create workspace"
              loading={creationIsSubmitting}
            />
          </form>
        </div>
      </AlertDialog>
    </>
  );
}
