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
      className="p-2 w-9 h-9 hover:cursor-pointer rounded-lg hover:bg-(--muted) transition-all duration-200 hover:text-(--foreground) shrink-0"
    >
      <Settings />
    </button>
  );
}
