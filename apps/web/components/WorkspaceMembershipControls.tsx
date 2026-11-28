/**
 * @module web/components/WorkspaceMembershipControls
 * @description The viewer's own place in a workspace, in the Permissions tab:
 * the owner picks a member to hand ownership to, and anyone else can leave.
 * Both ask for confirmation in a dialog first.
 *
 * @important The owner sees no Leave button, only the note that ownership has
 *            to be transferred first, mirroring the API, which refuses an
 *            owner's leave. Nimbus is never offered as a new owner.
 */
"use client";

import type { Workspace } from "@nimbus/types";
import AlertDialog from "@nimbus/ui/AlertDialog";
import Button from "@nimbus/ui/Button";
import Select from "@nimbus/ui/Select";
import { useState } from "react";
import { useWorkspaceMembership } from "../hooks/useWorkspaceMembership";

const CANCEL_CLASS =
  "bg-transparent border border-(--line-2) text-(--foreground) hover:bg-(--surface-3) rounded-xl";

/**
 * @param props.workspace - The workspace and its members.
 * @param props.userId - The signed-in user.
 */
export default function WorkspaceMembershipControls({
  workspace,
  userId,
}: {
  workspace: Workspace;
  userId?: string;
}) {
  const membership = useWorkspaceMembership(workspace.id, userId);
  const [newOwnerId, setNewOwnerId] = useState("");

  const me = workspace.members.find((member) => member.id === userId);
  if (!me) return null;
  const isOwner = me.role === "OWNER";
  const candidates = workspace.members.filter(
    (member) =>
      member.id !== userId && member.id !== process.env.NEXT_PUBLIC_BOT_USERID,
  );
  const newOwner = candidates.find((member) => member.id === newOwnerId);

  return (
    <div
      className="p-4 rounded-xl border border-(--line-2) bg-(--panel) space-y-3"
      data-testid="membership-controls"
    >
      <div>
        <div className="text-sm font-medium">Your membership</div>
        <div className="text-xs text-(--muted-foreground)">
          {isOwner
            ? "You own this workspace. To leave it, first hand ownership to another member; you will stay on as an admin."
            : "Leaving removes your access to this workspace's chat, documents and meetings. You can rejoin with an invite code."}
        </div>
      </div>

      {membership.error && (
        <p role="alert" className="text-xs text-(--destructive)">
          {membership.error}
        </p>
      )}
      {membership.notice && (
        <p role="status" className="text-xs text-(--muted-foreground)">
          {membership.notice}
        </p>
      )}

      {isOwner ? (
        candidates.length === 0 ? (
          <p className="text-xs text-(--muted-foreground)">
            Invite someone first: there is nobody to hand ownership to yet.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Select
              id="new-owner"
              label="New owner"
              value={newOwnerId}
              onChange={setNewOwnerId}
              options={[
                { value: "", label: "Choose a member" },
                ...candidates.map((member) => ({
                  value: member.id,
                  label: member.name,
                })),
              ]}
              className="w-56"
              triggerClassName="h-8 rounded-lg text-xs"
            />
            <AlertDialog
              trigger={
                <Button
                  type="button"
                  size="sm"
                  disabled={!newOwner}
                  className="hover:cursor-pointer rounded-xl"
                >
                  Transfer ownership
                </Button>
              }
            >
              <div className="relative z-50 w-110 rounded-2xl border border-(--line-2) bg-(--surface-1) shadow-2xl p-6">
                <h3 className="font-display font-semibold mb-4">Transfer ownership</h3>
                <p className="text-sm text-(--muted-foreground) mb-6">
                  Make {newOwner?.name ?? "this member"} the owner of{" "}
                  {workspace.name}? You will become an admin, and only the new
                  owner can give it back.
                </p>
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    size="sm"
                    data-alert-dialog-close
                    className={CANCEL_CLASS}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    data-alert-dialog-close
                    loading={membership.loading === "transfer"}
                    onClick={() => {
                      if (newOwner) void membership.handleTransfer(newOwner.id);
                    }}
                    className="rounded-xl"
                  >
                    Transfer
                  </Button>
                </div>
              </div>
            </AlertDialog>
          </div>
        )
      ) : (
        <AlertDialog
          trigger={
            <Button
              type="button"
              size="sm"
              className="hover:cursor-pointer rounded-xl bg-(--destructive) hover:bg-(--destructive)/80"
            >
              Leave Workspace
            </Button>
          }
        >
          <div className="relative z-50 w-110 rounded-2xl border border-(--line-2) bg-(--surface-1) shadow-2xl p-6">
            <h3 className="font-display font-semibold mb-4">Leave Workspace</h3>
            <p className="text-sm text-(--muted-foreground) mb-6">
              Leave {workspace.name}? You will lose access until someone shares
              an invite code with you again.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                size="sm"
                data-alert-dialog-close
                className={CANCEL_CLASS}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                data-alert-dialog-close
                loading={membership.loading === "leave"}
                onClick={() => void membership.handleLeave()}
                className="bg-(--destructive) hover:bg-(--destructive)/80 rounded-xl"
              >
                Leave
              </Button>
            </div>
          </div>
        </AlertDialog>
      )}
    </div>
  );
}
