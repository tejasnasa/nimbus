/**
 * @module web/components/WorkspaceSettingsButton
 * @description Gear button that opens the workspace settings dialog owned by
 * `WorkspaceSettingsProvider`. Sits in the workspace sidebar header, so
 * settings stay reachable whether or not the user is on the call.
 */
"use client";

import Settings from "@nimbus/ui/icons/Settings";
import { useWorkspaceSettings } from "./WorkspaceSettingsContext";

/** Opens the settings dialog on its first tab. */
export default function WorkspaceSettingsButton() {
  const settings = useWorkspaceSettings();

  return (
    <button
      type="button"
      title="Workspace settings"
      onClick={() => settings.open()}
      aria-label="Workspace settings"
      className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-(--line-2) bg-(--surface-1) text-(--text-body) transition-colors hover:cursor-pointer hover:border-(--line-3) hover:bg-(--surface-3) hover:text-(--foreground)"
    >
      <Settings className="size-4.5" />
    </button>
  );
}
