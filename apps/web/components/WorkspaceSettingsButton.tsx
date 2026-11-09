/**
 * @module web/components/WorkspaceSettingsButton
 * @description Gear button opening `WorkspaceSettings` in an `AlertDialog`.
 * Sits in the workspace sidebar header, so settings stay reachable whether or
 * not the user is on the call.
 */
"use client";

import { Workspace } from "@nimbus/types";
import AlertDialog from "@nimbus/ui/AlertDialog";
import Settings from "@nimbus/ui/icons/Settings";
import { ClientDocument } from "../api/document";
import WorkspaceSettings from "./WorkspaceSettings";

/**
 * @param props.workspace - Workspace the settings edit.
 * @param props.documents - Workspace docs (forwarded to settings).
 */
export default function WorkspaceSettingsButton({
  workspace,
  documents,
}: {
  workspace: Workspace;
  documents: ClientDocument[];
}) {
  return (
    <AlertDialog
      trigger={
        <button
          title="Workspace settings"
          className="p-2 w-9 h-9 hover:cursor-pointer rounded-lg hover:bg-(--muted) transition-all duration-200 hover:text-(--foreground) shrink-0"
        >
          <Settings />
        </button>
      }
    >
      <WorkspaceSettings workspace={workspace} documents={documents} />
    </AlertDialog>
  );
}
