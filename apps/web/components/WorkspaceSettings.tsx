"use client";

import { AiWorkspaceStatusDTO, Workspace } from "@nimbus/types";
import AlertDialog from "@nimbus/ui/AlertDialog";
import Avatar from "@nimbus/ui/Avatar";
import Button from "@nimbus/ui/Button";
import Delete from "@nimbus/ui/icons/Delete";
import Error from "@nimbus/ui/icons/Error";
import Input from "@nimbus/ui/Input";
import OptionMenu from "@nimbus/ui/OptionsMenu";
import SettingTabs from "@nimbus/ui/SettingTabs";
import Textarea from "@nimbus/ui/Textarea";
import { avatarFor } from "../lib/nimbusAvatar";
import type { ReactNode } from "react";
import { ClientDocument } from "../api/document";
import { useUpdateWorkspaceSettingsForm } from "../hooks/useUpdateWorkspaceSettingsForm";
import { useLiveDocuments } from "../hooks/useLiveDocuments";
import { useWorkspaceDocuments } from "../hooks/useWorkspaceDocuments";
import { useWorkspaceAiStatus } from "../hooks/useWorkspaceAiStatus";
import { useWorkspaceMembers } from "../hooks/useWorkspaceMembers";
import { useWorkspacePermissions } from "../hooks/useWorkspacePermissions";
/**
 * @module web/components/WorkspaceSettings
 * @description Workspace settings modal: a full-height navigation column
 * (`SettingTabs`) beside a content column with the active tab's title and a
 * close button. Tabs: General (rename form, dirty-gated save), Members
 * (role OptionMenu + remove confirmations), Documents (a keyword search box,
 * the `NewDocumentDialog` button, and per-doc rename, download and delete; the
 * list follows `document:*` events live), AI (workspace provider keys,
 * models, assistant switches and spend cap for admins; a read-only summary for
 * members), Usage (admins only: the AI call log), Meetings (every member:
 * the calls Nimbus joined with their notes, action items and transcripts,
 * searchable, in the viewer's caption language where translations are stored;
 * `initialTab="Meetings"` lands here from the call card), Captions (the viewer's own live caption look and
 * language, when a user is given), and Permissions (invite
 * copy/regenerate, leaving or handing on ownership, and danger-zone delete).
 * New docs, and any doc clicked in the Documents list, open via the
 * `DocEditorRefContext` add-tab bridge, which also reopens a closed tab.
 */
import CaptionSettingsPanel from "./CaptionSettingsPanel";
import { useDocEditorRef } from "./DocEditorRefContext";
import DocumentRow from "./DocumentRow";
import DocumentSearch from "./DocumentSearch";
import NewDocumentDialog from "./NewDocumentDialog";
import WorkspaceAiPanel from "./WorkspaceAiPanel";
import WorkspaceMeetingsPanel from "./WorkspaceMeetingsPanel";
import WorkspaceMembershipControls from "./WorkspaceMembershipControls";
import WorkspaceUsagePanel from "./WorkspaceUsagePanel";

const FIELD_LABEL = "text-[13px] font-medium text-(--text-soft)";
const ROW =
  "group flex items-center justify-between gap-3.5 rounded-[13px] border border-(--line-1) bg-(--panel) px-3.5 py-3 transition-colors hover:bg-(--grid-line)";
const SECONDARY_BUTTON =
  "min-h-10 rounded-[10px] border border-(--line-3) bg-transparent px-3.5 text-sm text-(--foreground) transition-colors hover:cursor-pointer hover:bg-(--surface-3) disabled:cursor-default disabled:opacity-60";
const DANGER_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] bg-red-600 px-3.5 text-sm font-semibold text-white transition-colors hover:cursor-pointer hover:bg-red-600/85 disabled:cursor-default disabled:opacity-60";

/**
 * @param props.workspace - Workspace under edit (seeds the rename form).
 * @param props.documents - Document list for the Documents tab.
 * @param props.initialTab - Label of the tab to open first (for example `"AI"`
 *                           when the chat banner sends an admin here).
 * @param props.initialAiStatus - The server-fetched AI status, so the
 *                                admin-only tabs are there from the first render.
 * @param props.userId - The signed-in user; enables their Captions tab.
 */
export default function WorkspaceSettings({
  workspace,
  documents,
  initialTab,
  initialAiStatus,
  userId,
}: {
  workspace: Workspace;
  documents: ClientDocument[];
  initialTab?: string;
  initialAiStatus?: AiWorkspaceStatusDTO;
  userId?: string;
}) {
  // One status fetch feeds the AI tab and decides whether Usage is offered.
  // Seeded from the server so the tab list does not change under the user.
  const aiStatus = useWorkspaceAiStatus(workspace.id, initialAiStatus);
  const canManageAi =
    aiStatus.state.kind === "ready" && aiStatus.state.status.canManage;

  const { register, firstError, isSubmitting, isDirty, onSubmit } =
    useUpdateWorkspaceSettingsForm(workspace);

  const {
    handleUpdateRole,
    handleRemoveMember,
    loading: memberLoading,
    error: memberError,
    notice: memberNotice,
  } = useWorkspaceMembers(workspace.id);

  const addTabRef = useDocEditorRef();
  const liveDocuments = useLiveDocuments(documents);

  const onDocumentCreated = (doc: ClientDocument) => {
    liveDocuments.add(doc);
    if (addTabRef.current) {
      addTabRef.current(doc);
    }
  };

  const {
    handleDeleteDocument,
    handleRenameDocument,
    handleDownloadDocument,
    loading: docLoading,
    error: docDeleteError,
    notice: docDeleteNotice,
  } = useWorkspaceDocuments({
    onDeleted: liveDocuments.remove,
    onRenamed: liveDocuments.rename,
  });

  const {
    handleRegenerateInviteCode,
    handleDeleteWorkspace,
    handleCopyInviteCode,
    loading: permissionLoading,
    error: permissionError,
    notice: permissionNotice,
  } = useWorkspacePermissions(workspace.id);

  return (
    <div
      role="dialog"
      aria-label="Workspace settings"
      className="relative z-50 flex h-[min(720px,calc(100vh-64px))] w-[min(1040px,calc(100vw-48px))] overflow-hidden rounded-[22px] border border-(--line-3) bg-(--surface-1) font-sans text-(--foreground) shadow-[0_50px_120px_rgba(0,0,0,0.65)]"
    >
      <SettingTabs
        defaultTab={initialTab}
        heading={
          <div className="flex flex-col gap-0.5">
            <span className="truncate font-display text-lg font-semibold">
              {workspace.name}
            </span>
            <h1 className="text-xs text-(--muted-foreground)">Settings</h1>
          </div>
        }
        headerAction={
          <button
            type="button"
            aria-label="Close settings"
            data-alert-dialog-close
            className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-(--surface-4) text-lg text-(--text-body) transition-colors hover:cursor-pointer hover:text-(--foreground)"
          >
            ×
          </button>
        }
        tabs={[
          {
            label: "General",
            description: "Name and description.",
            content: (
              <form
                onSubmit={onSubmit}
                className="flex flex-col gap-4.5"
              >
                <div className="flex flex-col gap-2">
                  <label htmlFor="title" className={FIELD_LABEL}>
                    Title
                  </label>
                  <Input
                    placeholder="Tejas's Workspace"
                    id="title"
                    className="w-full"
                    {...register("name")}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="description" className={FIELD_LABEL}>
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
                  <div className="flex items-center gap-2 rounded-lg border border-(--destructive)/20 bg-(--destructive)/10 px-3 py-2">
                    <Error className="size-4 shrink-0 text-(--destructive)" />
                    <span className="text-xs text-(--destructive)">
                      {firstError}
                    </span>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    className="min-h-10.5 rounded-[11px] px-4.5 font-semibold hover:cursor-pointer"
                    disabled={!isDirty || isSubmitting}
                    loading={isSubmitting}
                  >
                    Save Changes
                  </Button>
                </div>
              </form>
            ),
          },
          {
            label: "Members",
            description: `Who is in ${workspace.name} and what they can do.`,
            content: (
              <div className="flex flex-col gap-2">
                <InlineMessages
                  scope="members"
                  error={memberError}
                  notice={memberNotice}
                />
                {workspace.members.map((member) => (
                  <div key={member.id} className={ROW}>
                    <div className="flex min-w-0 items-center gap-3.5">
                      <Avatar
                        user={{
                          image: avatarFor(member.id, member.image),
                          name: member.name,
                        }}
                        classname="size-9.5 shrink-0 [&>img]:rounded-[11px]"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {member.name}
                        </div>
                        <div className="text-xs text-(--muted-foreground)">
                          {member.role}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <OptionMenu
                        trigger={
                          <Button
                            size="sm"
                            className="rounded-[9px] border border-(--line-3) bg-(--surface-3) text-[11px] uppercase text-(--foreground) hover:bg-(--surface-4)"
                            loading={memberLoading === member.id}
                          >
                            {member.role}
                          </Button>
                        }
                        size="sm"
                        direction="left"
                        items={[
                          {
                            label: "Owner",
                            onClick: () => handleUpdateRole(member.id, "OWNER"),
                          },
                          {
                            label: "Admin",
                            onClick: () => handleUpdateRole(member.id, "ADMIN"),
                          },
                          {
                            label: "Member",
                            onClick: () =>
                              handleUpdateRole(member.id, "MEMBER"),
                          },
                        ]}
                      />
                      <ConfirmDialog
                        trigger={
                          <button
                            aria-label={`Remove ${member.name}`}
                            className="grid size-9 place-items-center rounded-[9px] transition-colors hover:cursor-pointer hover:bg-(--destructive)/10"
                          >
                            <Delete className="size-4 text-(--destructive)" />
                          </button>
                        }
                        title="Remove Member"
                        description="Are you sure you want to remove this member? They will lose access to this workspace."
                        confirmLabel="Remove"
                        loading={memberLoading === member.id}
                        onConfirm={() => handleRemoveMember(member.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ),
          },
          {
            label: "Documents",
            description: "Every doc and board in the workspace.",
            content: (
              <div className="flex flex-col gap-3.5">
                <InlineMessages
                  scope="documents"
                  error={docDeleteError}
                  notice={docDeleteNotice}
                />
                <div className="flex flex-wrap items-start gap-2.5">
                  <div className="min-w-65 flex-1">
                    <DocumentSearch workspaceId={workspace.id} />
                  </div>
                  <NewDocumentDialog
                    workspaceId={workspace.id}
                    onCreated={onDocumentCreated}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  {liveDocuments.documents.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      busy={docLoading === document.id}
                      onRename={(title) =>
                        handleRenameDocument(document.id, title)
                      }
                      onDownload={() =>
                        void handleDownloadDocument(document.id, document.label)
                      }
                      onOpen={() => addTabRef.current?.(document)}
                    >
                      <ConfirmDialog
                        trigger={
                          <button
                            type="button"
                            aria-label={`Delete "${document.label}"`}
                            className="rounded-lg p-1.5 opacity-0 transition-colors hover:cursor-pointer hover:bg-(--destructive)/10 focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <Delete className="size-4 text-(--destructive)" />
                          </button>
                        }
                        title="Delete Document"
                        description="Are you sure you want to delete this document? This action cannot be undone."
                        confirmLabel="Delete"
                        loading={docLoading === document.id}
                        onConfirm={() => handleDeleteDocument(document.id)}
                      />
                    </DocumentRow>
                  ))}
                </div>
              </div>
            ),
          },
          {
            label: "AI",
            description: "Keys, models and the spend cap.",
            content: (
              <WorkspaceAiPanel workspaceId={workspace.id} status={aiStatus} />
            ),
          },
          ...(canManageAi
            ? [
                {
                  label: "Usage",
                  description: "Every AI call, with its cost.",
                  nested: true,
                  content: <WorkspaceUsagePanel workspaceId={workspace.id} />,
                },
              ]
            : []),
          {
            label: "Meetings",
            description: "Calls Nimbus was in, newest first.",
            content: (
              <WorkspaceMeetingsPanel
                workspaceId={workspace.id}
                userId={userId}
                members={workspace.members}
              />
            ),
          },
          ...(userId
            ? [
                {
                  label: "Captions",
                  description: "How live captions look for you.",
                  nested: true,
                  content: <CaptionSettingsPanel userId={userId} />,
                },
              ]
            : []),
          {
            label: "Permissions",
            description: "Invites and ownership.",
            content: (
              <div className="flex flex-col gap-4.5">
                <InlineMessages
                  scope="permissions"
                  error={permissionError}
                  notice={permissionNotice}
                />
                <div className="flex flex-col gap-3 rounded-[14px] border border-(--line-1) bg-(--panel) p-4.5">
                  <div>
                    <div className="font-display text-base font-semibold">
                      Invite Code
                    </div>
                    <div className="mt-0.5 text-[13px] text-(--muted-foreground)">
                      Share this code to invite members. A new code stops the
                      old one working.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`${SECONDARY_BUTTON} min-h-11 flex-1 rounded-[11px]`}
                      onClick={() => handleCopyInviteCode(workspace.inviteCode)}
                    >
                      Copy Invite Code
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[11px] bg-(--surface-4) px-3.5 text-sm text-(--foreground) transition-colors hover:cursor-pointer hover:bg-(--surface-4)/80 disabled:opacity-60"
                      onClick={handleRegenerateInviteCode}
                      disabled={permissionLoading === "regenerate"}
                    >
                      Regenerate
                    </button>
                  </div>
                </div>

                <WorkspaceMembershipControls
                  workspace={workspace}
                  userId={userId}
                />

                <div className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-[#4a2a2e] bg-(--destructive)/5 p-4.5">
                  <div className="flex flex-col gap-0.75">
                    <span className="font-semibold text-red-200">
                      Danger Zone
                    </span>
                    <span className="text-[13px] text-(--muted-foreground)">
                      Only the owner can delete the workspace. Docs, boards,
                      chat and meetings go with it.
                    </span>
                  </div>
                  <ConfirmDialog
                    trigger={
                      <button type="button" className={DANGER_BUTTON}>
                        <Delete className="size-4" />
                        Delete Workspace
                      </button>
                    }
                    title="Delete Workspace"
                    description="Are you sure you want to delete this workspace? All messages, documents, and member data will be permanently removed. This action cannot be undone."
                    confirmLabel="Delete Forever"
                    loading={permissionLoading === "delete"}
                    onConfirm={handleDeleteWorkspace}
                  />
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * A confirmation dialog for a destructive action: a trigger, a title and
 * explanation, Cancel, and a red confirm button. Confirming and cancelling both
 * close the dialog.
 *
 * @param props.trigger - Element that opens the dialog.
 * @param props.title - Dialog heading.
 * @param props.description - What will happen.
 * @param props.confirmLabel - Text of the destructive button.
 * @param props.loading - Shows a spinner on the destructive button.
 * @param props.onConfirm - Runs the action.
 */
function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  loading,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  loading: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog trigger={trigger}>
      <div className="relative z-50 w-[min(440px,calc(100vw-40px))] rounded-[20px] border border-(--line-3) bg-(--surface-1) p-6 font-sans shadow-[0_50px_120px_rgba(0,0,0,0.65)]">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-(--destructive)/15">
            <Delete className="size-5 text-(--destructive)" />
          </div>
          <h3 className="font-display text-lg font-semibold">{title}</h3>
        </div>
        <p className="mb-6 text-sm text-(--muted-foreground)">{description}</p>
        <div className="flex justify-end gap-2.5">
          <Button
            type="button"
            size="sm"
            data-alert-dialog-close
            className="min-h-10 rounded-[10px] border border-(--line-3) bg-transparent text-(--foreground) hover:bg-(--surface-3)"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            loading={loading}
            data-alert-dialog-close
            className="min-h-10 rounded-[10px] bg-red-600 font-semibold text-white hover:bg-red-600/85"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </AlertDialog>
  );
}

/**
 * Inline result line for a settings tab: an error in the destructive tone, or a
 * neutral confirmation. Renders nothing when there is neither. Rendered inline
 * because this app has no toast and does not use `alert()`.
 */
function InlineMessages({
  scope,
  error,
  notice,
}: {
  scope: string;
  error: string | null;
  notice: string | null;
}) {
  if (error) {
    return (
      <div
        role="alert"
        data-testid={`${scope}-error`}
        className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20"
      >
        <Error className="w-4 h-4 text-(--destructive) shrink-0" />
        <span className="text-xs text-(--destructive)">{error}</span>
      </div>
    );
  }
  if (notice) {
    return (
      <p
        role="status"
        data-testid={`${scope}-notice`}
        className="px-3 py-2 mb-3 rounded-lg bg-(--panel) border border-(--line-2) text-xs text-(--muted-foreground)"
      >
        {notice}
      </p>
    );
  }
  return null;
}
