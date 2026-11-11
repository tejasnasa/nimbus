/**
 * @module web/components/WorkspaceSettingsContext
 * @description Owns the workspace's one settings dialog and lets anything under
 * it open that dialog on a chosen tab: the header gear opens it on the first
 * tab, the chat banner on "AI", and the call card's Meetings button on
 * "Meetings". A small context rather than a store, because all the tree needs
 * is "open settings here" and "close it".
 *
 * @important The settings content mounts when the dialog opens and unmounts
 *            when it closes, and `SettingTabs` reads its starting tab only on
 *            mount. A fresh `key` per opening is therefore what makes a second
 *            request for a different tab take effect.
 *
 * @important `useOptionalWorkspaceSettings` returns null outside the provider
 *            so call UI and the settings content render standalone (in tests,
 *            or anywhere without a workspace page around them), just without
 *            the shortcut.
 */
"use client";

import type { AiWorkspaceStatusDTO, Workspace } from "@nimbus/types";
import AlertDialog from "@nimbus/ui/AlertDialog";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ClientDocument } from "../api/document";
import { useLiveDocuments } from "../hooks/useLiveDocuments";
import WorkspaceSettings from "./WorkspaceSettings";

/** What a consumer can do with the settings dialog. */
export type WorkspaceSettingsControls = {
  /** Opens settings, on the tab with this label when given. */
  open: (tab?: string) => void;
  close: () => void;
};

const SettingsContext = createContext<WorkspaceSettingsControls | null>(null);

type DialogState = { open: boolean; tab?: string; opening: number };

/**
 * @param props.workspace - Workspace the settings edit.
 * @param props.documents - Workspace docs (forwarded to settings).
 * @param props.initialAiStatus - Server-fetched AI status (forwarded to settings).
 * @param props.userId - Signed-in user (forwarded to settings).
 * @param props.children - The tree that can open the dialog.
 */
export function WorkspaceSettingsProvider({
  workspace,
  documents,
  initialAiStatus,
  userId,
  children,
}: {
  workspace: Workspace;
  documents: ClientDocument[];
  initialAiStatus?: AiWorkspaceStatusDTO;
  userId?: string;
  children: ReactNode;
}) {
  // Followed here, not inside the dialog, which only exists while it is open:
  // a document created or deleted meanwhile must already be in the list when
  // the dialog next opens.
  const live = useLiveDocuments(documents);
  const [state, setState] = useState<DialogState>({
    open: false,
    opening: 0,
  });

  const open = useCallback((tab?: string) => {
    setState((prev) => ({ open: true, tab, opening: prev.opening + 1 }));
  }, []);
  const close = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }));
  }, []);
  const controls = useMemo(() => ({ open, close }), [open, close]);

  return (
    <SettingsContext.Provider value={controls}>
      {children}
      <AlertDialog
        open={state.open}
        onOpenChange={(next) => (next ? undefined : close())}
      >
        <WorkspaceSettings
          key={state.opening}
          workspace={workspace}
          documents={live.documents}
          initialTab={state.tab}
          initialAiStatus={initialAiStatus}
          userId={userId}
        />
      </AlertDialog>
    </SettingsContext.Provider>
  );
}

/** Controls for the settings dialog; throws outside the provider. */
export function useWorkspaceSettings(): WorkspaceSettingsControls {
  const controls = useContext(SettingsContext);
  if (!controls) {
    throw new Error(
      "useWorkspaceSettings must be used within WorkspaceSettingsProvider",
    );
  }
  return controls;
}

/** Controls for the settings dialog, or null when there is no provider. */
export function useOptionalWorkspaceSettings(): WorkspaceSettingsControls | null {
  return useContext(SettingsContext);
}
