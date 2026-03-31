"use client";

import { Workspace } from "@nimbus/types";
import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import SettingTabs from "@nimbus/ui/SettingTabs";
import Textarea from "@nimbus/ui/Textarea";
import { ClientDocument } from "../api/document";
import Avatar from "@nimbus/ui/Avatar";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import Flow from "@nimbus/ui/icons/Flow";
import Markdown from "@nimbus/ui/icons/Markdown";
import Delete from "@nimbus/ui/icons/Delete";
import { useUpdateWorkspaceSettingsForm } from "../hooks/useUpdateWorkspaceSettingsForm";
import AlertDialog from "@nimbus/ui/AlertDialog";
import OptionMenu from "@nimbus/ui/OptionsMenu";
import { useWorkspaceMembers } from "../hooks/useWorkspaceMembers";
import { useWorkspaceDocumentForm } from "../hooks/useWorkspaceDocumentForm";
import { useWorkspaceDocuments } from "../hooks/useWorkspaceDocuments";
import ToggleGroup from "@nimbus/ui/ToggleGroup";

export default function WorkspaceSettings({
  workspace,
  documents,
}: {
  workspace: Workspace;
  documents: ClientDocument[];
}) {
  const { register, firstError, isSubmitting, isDirty, onSubmit } =
    useUpdateWorkspaceSettingsForm(workspace);

  const { handleUpdateRole, handleRemoveMember, loading: memberLoading } =
    useWorkspaceMembers(workspace.id);

  const {
    register: docRegister,
    firstError: docError,
    isSubmitting: docSubmitting,
    onSubmit: docOnSubmit,
    setValue: docSetValue,
  } = useWorkspaceDocumentForm(workspace.id);

  const { handleDeleteDocument, loading: docLoading } = useWorkspaceDocuments();

  return (
    <div className=" relative z-50 w-200 h-150 rounded-xl border border-(--border) bg-(--card) shadow-lg animate-in fade-in zoom-in-95 p-5">
      <h1 className="text-5xl m-2 mb-8">Settings</h1>
      <SettingTabs
        tabs={[
          {
            label: "General",
            content: (
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
                  />
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
                  <span className="text-xs m-4 text-red-500 self-start">
                    {firstError}
                  </span>
                )}

                <div className="m-4 flex justify-end gap-2">
                  <Button
                    size="sm"
                    className="hover:cursor-pointer"
                    disabled={!isDirty || isSubmitting}
                    loading={isSubmitting}
                  >
                    Save
                  </Button>
                </div>
              </form>
            ),
          },
          {
            label: "Members",
            content: (
              <div>
                {workspace.members.map((member) => (
                  <div
                    key={member.id}
                    className="flex justify-content justify-between items-center m-4"
                  >
                    <div className="flex justify-content justify-between items-center">
                      <Avatar
                        user={{
                          image: member.image || getAvatarForUser(member.id),
                          name: member.name,
                        }}
                        classname="w-12 h-12 mr-3"
                      />
                      <div>{member.name}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <OptionMenu
                        trigger={
                          <Button
                            size="sm"
                            className="bg-transparent text-(--foreground) hover:bg-(--muted) border border-(--border) uppercase text-[10px]"
                            loading={memberLoading === member.id}
                          >
                            {member.role}
                          </Button>
                        }
                        size="sm"
                        direction="left"
                        items={[
                          {
                            label: "OWNER",
                            onClick: () => handleUpdateRole(member.id, "OWNER"),
                          },
                          {
                            label: "ADMIN",
                            onClick: () => handleUpdateRole(member.id, "ADMIN"),
                          },
                          {
                            label: "MEMBER",
                            onClick: () => handleUpdateRole(member.id, "MEMBER"),
                          },
                        ]}
                      />
                      <AlertDialog
                        trigger={
                          <Delete className="w-5 h-5 m-2 text-(--destructive) hover:cursor-pointer" />
                        }
                      >
                        <div className=" relative z-50 w-120 rounded-xl border border-(--border) bg-(--card) shadow-lg animate-in fade-in zoom-in-95 p-5">
                          <h3 className="mb-8">
                            Are you sure you want to remove this member?
                          </h3>
                          <div className="flex justify-end gap-2">
                            <Button size="sm" data-alert-dialog-close>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleRemoveMember(member.id)}
                              loading={memberLoading === member.id}
                              data-alert-dialog-close
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
                <AlertDialog
                  trigger={
                    <Button className="hover:cursor-pointer">
                      Add Document
                    </Button>
                  }
                >
                  <div className=" relative z-50 w-120 rounded-xl border border-(--border) bg-(--card) shadow-lg animate-in fade-in zoom-in-95 p-5">
                    <h2 className="text-2xl font-semibold m-4">
                      Create Document
                    </h2>
                    <form onSubmit={docOnSubmit}>
                      <input type="hidden" {...docRegister("workspaceId")} />
                      <input type="hidden" {...docRegister("type")} />
                      <div className="flex flex-col text-left m-4">
                        <label htmlFor="docTitle" className="m-1 text-sm">
                          Title
                        </label>
                        <Input
                          placeholder="My Awesome Document"
                          id="docTitle"
                          className="w-full"
                          {...docRegister("title")}
                        />
                      </div>
                      <div className="flex flex-col text-center">
                        <label className="text-sm">Type</label>
                        <ToggleGroup
                          options={["MARKDOWN", "CANVAS"]}
                          onChange={(val) =>
                            docSetValue("type", val as "MARKDOWN" | "CANVAS")
                          }
                        />
                      </div>

                      {docError && (
                        <span className="text-xs text-red-500 m-4 block">
                          {docError}
                        </span>
                      )}

                      <div className="flex justify-end gap-2 m-4">
                        <Button
                          size="sm"
                          type="button"
                          data-alert-dialog-close
                          className="bg-transparent border border-(--border)"
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          loading={docSubmitting}
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

                {documents.map((document) => (
                  <div
                    key={document.id}
                    className="flex m-4 justify-between items-center"
                  >
                    <div className="flex items-center">
                      {document.type === "MARKDOWN" ? (
                        <Markdown className="w-8 h-8 mr-4" />
                      ) : (
                        <Flow className="w-8 h-8 mr-4" />
                      )}
                      <div>{document.label}</div>
                    </div>
                    <div className="flex">
                      <AlertDialog
                        trigger={
                          <Delete className="w-4 h-4 mr-4 text-(--destructive) hover:cursor-pointer" />
                        }
                      >
                        <div className=" relative z-50 w-120 rounded-xl border border-(--border) bg-(--card) shadow-lg animate-in fade-in zoom-in-95 p-5">
                          <h3 className="mb-8">
                            Are you sure you want to delete this document?
                          </h3>
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" data-alert-dialog-close>
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleDeleteDocument(document.id)}
                              loading={docLoading === document.id}
                              data-alert-dialog-close
                            >
                              Delete
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
            label: "Permissions",
            content: (
              <div>
                <Button className="hover:cursor-pointer">
                  Regenerate Invite Code
                </Button>
                <Button className="hover:cursor-pointer">
                  Copy Invite Code
                </Button>
                <Button className="hover:cursor-pointer">
                  <Delete className="w-6 h-6" />
                  Delete Workspace
                </Button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
