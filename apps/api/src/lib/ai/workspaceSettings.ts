/**
 * @module api/lib/ai/workspaceSettings
 * @description Reads a workspace's AI switches (spend cap, assistant on/off,
 * assistant speaks) with the documented defaults when no row exists yet.
 *
 * A workspace gets its `WorkspaceAiSettings` row lazily, on the first save, so
 * every reader goes through here rather than treating a missing row as an error.
 */
import { prisma } from "@nimbus/db";

/** The settings as the resolvers consume them. */
export type WorkspaceAiSettingsView = {
  /** Month-to-date spend ceiling in USD, or `null` for none. */
  readonly monthlySpendCapUsd: number | null;
  readonly assistantEnabled: boolean;
  readonly assistantSpeaks: boolean;
};

/** What an untouched workspace gets. */
export const DEFAULT_WORKSPACE_AI_SETTINGS: WorkspaceAiSettingsView = {
  monthlySpendCapUsd: null,
  assistantEnabled: true,
  assistantSpeaks: true,
};

/**
 * Loads the settings for a workspace.
 *
 * @param workspaceId - The workspace.
 * @param db - Prisma handle; defaults to the singleton.
 * @returns The stored settings, or the defaults when none are stored.
 */
export async function readWorkspaceAiSettings(
  workspaceId: string,
  db: Pick<typeof prisma, "workspaceAiSettings"> = prisma,
): Promise<WorkspaceAiSettingsView> {
  const row = await db.workspaceAiSettings.findUnique({
    where: { workspaceId },
  });
  if (!row) return DEFAULT_WORKSPACE_AI_SETTINGS;
  return {
    monthlySpendCapUsd:
      row.monthlySpendCapUsd === null ? null : Number(row.monthlySpendCapUsd),
    assistantEnabled: row.assistantEnabled,
    assistantSpeaks: row.assistantSpeaks,
  };
}
