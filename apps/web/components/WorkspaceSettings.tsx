"use client";

import { AiWorkspaceStatusDTO, Workspace } from "@nimbus/types";
import AlertDialog from "@nimbus/ui/AlertDialog";
import Avatar from "@nimbus/ui/Avatar";
import Button from "@nimbus/ui/Button";
import Delete from "@nimbus/ui/icons/Delete";
import Error from "@nimbus/ui/icons/Error";
import Flow from "@nimbus/ui/icons/Flow";
import Lock from "@nimbus/ui/icons/Lock";
import Markdown from "@nimbus/ui/icons/Markdown";
import Plus from "@nimbus/ui/icons/Plus";
import Settings from "@nimbus/ui/icons/Settings";
import Input from "@nimbus/ui/Input";
import OptionMenu from "@nimbus/ui/OptionsMenu";
import SettingTabs from "@nimbus/ui/SettingTabs";
import Textarea from "@nimbus/ui/Textarea";
import ToggleGroup from "@nimbus/ui/ToggleGroup";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { useRef } from "react";
import { ClientDocument } from "../api/document";
import {
  CHAT_IMAGE_ACCEPT,
  useChatImageUpload,
} from "../hooks/useChatImageUpload";
import { socket } from "../lib/socket";
import { useUpdateWorkspaceSettingsForm } from "../hooks/useUpdateWorkspaceSettingsForm";
import { useWorkspaceDocumentForm } from "../hooks/useWorkspaceDocumentForm";
import { useWorkspaceDocuments } from "../hooks/useWorkspaceDocuments";
import { useWorkspaceAiStatus } from "../hooks/useWorkspaceAiStatus";
import { useWorkspaceMembers } from "../hooks/useWorkspaceMembers";
import { useWorkspacePermissions } from "../hooks/useWorkspacePermissions";
/**
 * @module web/components/WorkspaceSettings
 * @description Workspace settings modal (~500 lines, largest component):
 * `SettingTabs` with General (rename form, dirty-gated save), Members
 * (role OptionMenu + remove confirmations), Documents (create dialog with
 * MARKDOWN/CANVAS ToggleGroup, a "From an image…" shortcut that uploads a
 * picture and asks NimbusBot to diagram it, + per-doc delete), AI (workspace provider keys,
 * models, assistant switches and spend cap for admins; a read-only summary for
 * members), Usage (admins only: the AI call log), Transcripts (every member:
 * past meetings NimbusBot transcribed), Captions (the viewer's own live caption
 * look, when a user is given), and Permissions (invite
 * copy/regenerate + danger-zone delete). New docs open via the
 * `DocEditorRefContext` add-tab bridge; the create dialog closes through the
 * hidden `close-doc-dialog` click in `useWorkspaceDocumentForm`.
 */
import CaptionSettingsPanel from "./CaptionSettingsPanel";
import { useDocEditorRef } from "./DocEditorRefContext";
import WorkspaceAiPanel from "./WorkspaceAiPanel";
import WorkspaceTranscriptsPanel from "./WorkspaceTranscriptsPanel";
import WorkspaceUsagePanel from "./WorkspaceUsagePanel";

/** The chat message "From an image…" posts alongside the uploaded picture. */
const IMAGE_TO_DIAGRAM_MESSAGE = "@nimbusbot turn this into a diagram";

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

  const imageUpload = useChatImageUpload(workspace.id);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // "From an image…" has no code path of its own: it uploads the picture and
  // posts the same chat message a member would type, so the bot, the quota and
  // the overlay behave exactly as they do from the composer.
  const handleImageToDiagram = async (file: File | undefined) => {
    if (!file) return;
    const imageUrl = await imageUpload.upload(file);
    if (!imageUrl) return;
    socket.emit("message:send", {
      workspaceId: workspace.id,
      content: IMAGE_TO_DIAGRAM_MESSAGE,
      imageUrl,
    });
    imageUpload.reset();
    document.getElementById("close-doc-dialog")?.click();
  };

  const {
    register: docRegister,
    firstError: docError,
    isSubmitting: docSubmitting,
    onSubmit: docOnSubmit,
    setValue: docSetValue,
  } = useWorkspaceDocumentForm(workspace.id, (doc) => {
    if (addTabRef.current) {
      addTabRef.current(doc);
    }
  });

  const {
    handleDeleteDocument,
    loading: docLoading,
    error: docDeleteError,
    notice: docDeleteNotice,
  } = useWorkspaceDocuments();

  const {
    handleRegenerateInviteCode,
    handleDeleteWorkspace,
    handleCopyInviteCode,
    loading: permissionLoading,
    error: permissionError,
    notice: permissionNotice,
  } = useWorkspacePermissions(workspace.id);

  return (
    <div className="relative z-50 w-250 h-180 rounded-2xl border border-(--border) bg-(--card) shadow-2xl shadow-(--primary)/10 p-6 flex flex-col">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-(--border)">
        <div className="w-10 h-10 rounded-xl bg-linear-to-br from-(--primary) to-(--sidebar-primary) flex items-center justify-center shrink-0">
          <Settings className="w-5 h-5 text-(--primary-foreground)" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-xs text-(--muted-foreground)">{workspace.name}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <SettingTabs
          defaultTab={initialTab}
          tabs={[
            {
              label: "General",
              content: (
                <form onSubmit={onSubmit} className="space-y-5">
                  <div className="flex flex-col gap-2">
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
                      {...register("name")}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
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
                      {...register("description")}
                    />
                  </div>

                  {firstError && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20">
                      <Error className="w-4 h-4 text-(--destructive) shrink-0" />
                      <span className="text-xs text-(--destructive)">
                        {firstError}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <Button
                      size="sm"
                      className="hover:cursor-pointer rounded-xl"
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
              content: (
                <div className="space-y-2">
                  <InlineMessages
                    scope="members"
                    error={memberError}
                    notice={memberNotice}
                  />
                  {workspace.members.map((member) => (
                    <div
                      key={member.id}
                      className="flex justify-between items-center p-3 rounded-xl hover:bg-(--muted)/30 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar
                          user={{
                            image: member.image || getAvatarForUser(member.id),
                            name: member.name,
                          }}
                          classname="w-10 h-10"
                        />
                        <div>
                          <div className="text-sm font-medium">
                            {member.name}
                          </div>
                          <div className="text-xs text-(--muted-foreground)">
                            {member.role}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 opacity-100 transition-opacity">
                        <OptionMenu
                          trigger={
                            <Button
                              size="sm"
                              className="bg-transparent text-(--foreground) hover:bg-(--muted) border border-(--border) uppercase text-[10px] rounded-lg"
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
                              onClick: () =>
                                handleUpdateRole(member.id, "OWNER"),
                            },
                            {
                              label: "Admin",
                              onClick: () =>
                                handleUpdateRole(member.id, "ADMIN"),
                            },
                            {
                              label: "Member",
                              onClick: () =>
                                handleUpdateRole(member.id, "MEMBER"),
                            },
                          ]}
                        />
                        <AlertDialog
                          trigger={
                            <button className="p-1.5 rounded-lg hover:bg-(--destructive)/10 transition-colors hover:cursor-pointer">
                              <Delete className="w-4 h-4 text-(--destructive)" />
                            </button>
                          }
                        >
                          <div className="relative z-50 w-100 rounded-2xl border border-(--border) bg-(--card) shadow-2xl p-6">
                            <div className="flex items-center gap-3 mb-4">
                              <div className="w-10 h-10 rounded-xl bg-(--destructive)/15 flex items-center justify-center shrink-0">
                                <Delete className="w-5 h-5 text-(--destructive)" />
                              </div>
                              <h3 className="font-semibold">Remove Member</h3>
                            </div>
                            <p className="text-sm text-(--muted-foreground) mb-6">
                              Are you sure you want to remove this member? They
                              will lose access to this workspace.
                            </p>
                            <div className="flex justify-end gap-3">
                              <Button
                                size="sm"
                                data-alert-dialog-close
                                className="bg-transparent border border-(--border) text-(--foreground) hover:bg-(--muted) rounded-xl"
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleRemoveMember(member.id)}
                                loading={memberLoading === member.id}
                                data-alert-dialog-close
                                className="bg-(--destructive) hover:bg-(--destructive)/80 rounded-xl"
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
            {
              label: "Documents",
              content: (
                <div>
                  <InlineMessages
                    scope="documents"
                    error={docDeleteError}
                    notice={docDeleteNotice}
                  />
                  <AlertDialog
                    trigger={
                      <Button className="space-y-1 relative hover:cursor-pointer w-135 mb-4">
                        + Add Document
                      </Button>
                    }
                  >
                    <div className="relative z-50 w-110 rounded-2xl border border-(--border) bg-(--card) shadow-2xl p-6">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-linear-to-br from-(--chart-2) to-(--primary) flex items-center justify-center shrink-0">
                          <Plus className="w-5 h-5 text-(--primary-foreground)" />
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold">
                            Create Document
                          </h2>
                          <p className="text-xs text-(--muted-foreground)">
                            Add a new document to this workspace
                          </p>
                        </div>
                      </div>
                      <form onSubmit={docOnSubmit}>
                        <input type="hidden" {...docRegister("workspaceId")} />
                        <input type="hidden" {...docRegister("type")} />
                        <div className="flex flex-col gap-2 mb-4">
                          <label
                            htmlFor="docTitle"
                            className="text-sm font-medium text-(--muted-foreground)"
                          >
                            Title
                          </label>
                          <Input
                            placeholder="My Awesome Document"
                            id="docTitle"
                            className="w-full"
                            {...docRegister("title")}
                          />
                        </div>
                        <div className="flex flex-col gap-2 mb-4">
                          <label className="text-sm font-medium text-(--muted-foreground)">
                            Type
                          </label>
                          <ToggleGroup
                            options={["MARKDOWN", "CANVAS"]}
                            onChange={(val) =>
                              docSetValue("type", val as "MARKDOWN" | "CANVAS")
                            }
                          />
                        </div>

                        <div className="mb-4">
                          <input
                            ref={imageInputRef}
                            type="file"
                            accept={CHAT_IMAGE_ACCEPT}
                            className="hidden"
                            data-testid="doc-image-input"
                            onChange={(e) => {
                              void handleImageToDiagram(e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                          <Button
                            size="sm"
                            type="button"
                            data-testid="doc-from-image"
                            loading={imageUpload.state.status === "uploading"}
                            onClick={() => imageInputRef.current?.click()}
                            className="w-full bg-transparent border border-(--border) text-(--foreground) hover:bg-(--muted) rounded-xl"
                          >
                            From an image…
                          </Button>
                          {imageUpload.state.status === "error" && (
                            <p
                              role="alert"
                              className="mt-1 text-xs text-(--destructive)"
                            >
                              {imageUpload.state.message}
                            </p>
                          )}
                        </div>

                        {docError && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20 mb-4">
                            <Error className="w-4 h-4 text-(--destructive) shrink-0" />
                            <span className="text-xs text-(--destructive)">
                              {docError}
                            </span>
                          </div>
                        )}

                        <div className="flex justify-end gap-3 mt-6">
                          <Button
                            size="sm"
                            type="button"
                            data-alert-dialog-close
                            className="bg-transparent border border-(--border) text-(--foreground) hover:bg-(--muted) rounded-xl"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            loading={docSubmitting}
                            className="rounded-xl"
                          >
                            Create
                          </Button>
                          <button
                            type="button"
                            id="close-doc-dialog"
                            data-alert-dialog-close
                            className="hidden"
                          ></button>
                        </div>
                      </form>
                    </div>
                  </AlertDialog>

                  <div className="space-y-1">
                    {documents.map((document) => (
                      <div
                        key={document.id}
                        className="flex justify-between items-center p-3 rounded-xl hover:bg-(--muted)/30 transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-(--muted)/50 flex items-center justify-center shrink-0">
                            {document.type === "MARKDOWN" ? (
                              <Markdown className="w-5 h-5 text-(--muted-foreground)" />
                            ) : (
                              <Flow className="w-5 h-5 text-(--muted-foreground)" />
                            )}
                          </div>
                          <div>
                            <div className="text-sm font-medium">
                              {document.label}
                            </div>
                            <div className="text-xs text-(--muted-foreground)">
                              {document.type}
                            </div>
                          </div>
                        </div>
                        <AlertDialog
                          trigger={
                            <button className="p-1.5 rounded-lg hover:bg-(--destructive)/10 transition-colors hover:cursor-pointer opacity-0 group-hover:opacity-100">
                              <Delete className="w-4 h-4 text-(--destructive)" />
                            </button>
                          }
                        >
                          <div className="relative z-50 w-[400px] rounded-2xl border border-(--border) bg-(--card) shadow-2xl p-6">
                            <div className="flex items-center gap-3 mb-4">
                              <div className="w-10 h-10 rounded-xl bg-(--destructive)/15 flex items-center justify-center shrink-0">
                                <Delete className="w-5 h-5 text-(--destructive)" />
                              </div>
                              <h3 className="font-semibold">Delete Document</h3>
                            </div>
                            <p className="text-sm text-(--muted-foreground) mb-6">
                              Are you sure you want to delete this document?
                              This action cannot be undone.
                            </p>
                            <div className="flex justify-end gap-3">
                              <Button
                                type="button"
                                size="sm"
                                data-alert-dialog-close
                                className="bg-transparent border border-(--border) text-(--foreground) hover:bg-(--muted) rounded-xl"
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  handleDeleteDocument(document.id)
                                }
                                loading={docLoading === document.id}
                                data-alert-dialog-close
                                className="bg-(--destructive) hover:bg-(--destructive)/80 rounded-xl"
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        </AlertDialog>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            },
            {
              label: "AI",
              content: (
                <WorkspaceAiPanel
                  workspaceId={workspace.id}
                  status={aiStatus}
                />
              ),
            },
            ...(canManageAi
              ? [
                  {
                    label: "Usage",
                    content: <WorkspaceUsagePanel workspaceId={workspace.id} />,
                  },
                ]
              : []),
            {
              label: "Transcripts",
              content: <WorkspaceTranscriptsPanel workspaceId={workspace.id} />,
            },
            ...(userId
              ? [
                  {
                    label: "Captions",
                    content: <CaptionSettingsPanel userId={userId} />,
                  },
                ]
              : []),
            {
              label: "Permissions",
              content: (
                <div className="space-y-4">
                  <InlineMessages
                    scope="permissions"
                    error={permissionError}
                    notice={permissionNotice}
                  />
                  <div className="p-4 rounded-xl border border-(--border) bg-(--muted)/20">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-lg bg-(--primary)/15 flex items-center justify-center">
                        <Lock className="w-4 h-4 text-(--primary)" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">Invite Code</div>
                        <div className="text-xs text-(--muted-foreground)">
                          Share this code to invite members
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        className="hover:cursor-pointer rounded-xl flex-1"
                        size="sm"
                        onClick={() =>
                          handleCopyInviteCode(workspace.inviteCode)
                        }
                      >
                        Copy Invite Code
                      </Button>
                      <Button
                        type="button"
                        className="hover:cursor-pointer rounded-xl bg-transparent border border-(--border) text-(--foreground) hover:bg-(--muted)"
                        size="sm"
                        onClick={handleRegenerateInviteCode}
                        loading={permissionLoading === "regenerate"}
                      >
                        Regenerate
                      </Button>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-(--destructive)/20 bg-(--destructive)/5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-lg bg-(--destructive)/15 flex items-center justify-center">
                        <Delete className="w-4 h-4 text-(--destructive)" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-(--destructive)">
                          Danger Zone
                        </div>
                        <div className="text-xs text-(--muted-foreground)">
                          Irreversible and destructive actions
                        </div>
                      </div>
                    </div>
                    <AlertDialog
                      trigger={
                        <Button
                          type="button"
                          className="hover:cursor-pointer rounded-xl bg-(--destructive) hover:bg-(--destructive)/80"
                          size="sm"
                        >
                          <Delete className="w-4 h-4" />
                          Delete Workspace
                        </Button>
                      }
                    >
                      <div className="relative z-50 w-110 rounded-2xl border border-(--border) bg-(--card) shadow-2xl p-6">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 rounded-xl bg-(--destructive)/15 flex items-center justify-center shrink-0">
                            <Delete className="w-5 h-5 text-(--destructive)" />
                          </div>
                          <h3 className="font-semibold">Delete Workspace</h3>
                        </div>
                        <p className="text-sm text-(--muted-foreground) mb-6">
                          Are you sure you want to delete this workspace? All
                          messages, documents, and member data will be
                          permanently removed. This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                          <Button
                            type="button"
                            size="sm"
                            data-alert-dialog-close
                            className="bg-transparent border border-(--border) text-(--foreground) hover:bg-(--muted) rounded-xl"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleDeleteWorkspace}
                            loading={permissionLoading === "delete"}
                            data-alert-dialog-close
                            className="bg-(--destructive) hover:bg-(--destructive)/80 rounded-xl"
                          >
                            Delete Forever
                          </Button>
                        </div>
                      </div>
                    </AlertDialog>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
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
        className="px-3 py-2 mb-3 rounded-lg bg-(--muted)/30 border border-(--border) text-xs text-(--muted-foreground)"
      >
        {notice}
      </p>
    );
  }
  return null;
}
