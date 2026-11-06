/**
 * @module api/scripts/copyAiCredentialsToWorkspaces
 * @description One-off migration of user-scoped AI keys and preferences to the
 * workspaces their owners administer.
 *
 * Keys used to belong to a person; they now belong to a workspace. For every
 * stored `AiCredential` this finds the workspaces where its user is OWNER or
 * ADMIN, decrypts the key with the user-scoped AAD, re-encrypts it with the
 * workspace-scoped AAD and creates a `WorkspaceAiCredential`. Each user's
 * `AiFeaturePreference` rows are copied alongside, into workspaces that have no
 * preference for that feature yet.
 *
 * Usage, from the API container (compiled to `dist/scripts`):
 *
 *     node dist/scripts/copyAiCredentialsToWorkspaces.js --dry-run
 *     node dist/scripts/copyAiCredentialsToWorkspaces.js
 *
 * Rules:
 *   - A user who is only a MEMBER anywhere contributes nothing: they could not
 *     manage a workspace key, and a key must not become readable to a workspace
 *     whose admins never saw it.
 *   - When two admins of one workspace both had a key for the same provider, the
 *     earliest `createdAt` (then `id`) wins, and the conflict is printed.
 *   - Where a workspace already has a credential or a preference, it is kept.
 *     That is also what makes a second run copy nothing.
 *   - Copied credentials get `verifiedKinds = ["text"]` when the source was
 *     validated, `[]` otherwise: the old save-time probe only ever tried text.
 *
 * @important The output is counts and non-secret ids only. It never prints a
 *            key, an envelope, a fingerprint or a masked preview, and it does
 *            not print an error's message (a database error can quote the row it
 *            was inserting).
 *
 * @important `--dry-run` decrypts every key it would copy, so an unreadable
 *            envelope is reported before the real run, but it writes nothing.
 */
import { prisma } from "@nimbus/db";
import { buildAad, decryptSecret, encryptSecret } from "../lib/ai/credentialCrypto";

/** What the script did, or would do. */
export type CopyReport = {
  readonly dryRun: boolean;
  /** Source credentials examined. */
  readonly sourceCredentials: number;
  /** Source credentials whose user administers no workspace. */
  readonly memberOnlySkipped: number;
  /** Credentials created, or that would be created on a real run. */
  readonly credentialsCopied: number;
  /** Targets that already had a credential for the provider. */
  readonly credentialsAlreadyPresent: number;
  /** Targets where several admins competed and the earliest won. */
  readonly credentialConflicts: number;
  /** Source envelopes that could not be decrypted. */
  readonly unreadable: number;
  /** Preferences created, or that would be. */
  readonly preferencesCopied: number;
  /** Preferences skipped because the workspace already had one for the feature. */
  readonly preferencesAlreadyPresent: number;
  /** Preferences skipped because the workspace has no key for their provider. */
  readonly preferencesWithoutCredential: number;
};

/** The collaborators the script uses; swappable in tests. */
export type CopyDeps = {
  readonly db?: typeof prisma;
  readonly log?: (line: string) => void;
};

/** Whether a thrown value is Prisma's unique-constraint violation. */
const isUniqueViolation = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: unknown }).code === "P2002";

/**
 * Copies user-scoped credentials and preferences to workspaces.
 *
 * @param options - `dryRun` reports without writing.
 * @param deps - Database handle and output sink.
 * @returns The counts, also printed through `log`.
 */
export async function copyAiCredentialsToWorkspaces(
  options: { dryRun: boolean },
  deps: CopyDeps = {},
): Promise<CopyReport> {
  const db = deps.db ?? prisma;
  const log = deps.log ?? ((line: string) => console.log(line));
  const { dryRun } = options;

  const [credentials, preferences, adminMemberships] = await Promise.all([
    db.aiCredential.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.aiFeaturePreference.findMany({
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    }),
    db.workspaceMember.findMany({
      where: { role: { in: ["OWNER", "ADMIN"] } },
      select: { userId: true, workspaceId: true },
    }),
  ]);

  const workspacesByUser = new Map<string, string[]>();
  for (const m of adminMemberships) {
    const list = workspacesByUser.get(m.userId) ?? [];
    list.push(m.workspaceId);
    workspacesByUser.set(m.userId, list);
  }

  let memberOnlySkipped = 0;
  let credentialsCopied = 0;
  let credentialsAlreadyPresent = 0;
  let credentialConflicts = 0;
  let unreadable = 0;

  // Candidates per (workspace, provider), already in winning order because the
  // source query is sorted by createdAt then id.
  const candidates = new Map<string, typeof credentials>();
  for (const credential of credentials) {
    const targets = workspacesByUser.get(credential.userId) ?? [];
    if (targets.length === 0) {
      memberOnlySkipped += 1;
      continue;
    }
    for (const workspaceId of targets) {
      const key = `${workspaceId}|${credential.providerId}`;
      const list = candidates.get(key) ?? [];
      list.push(credential);
      candidates.set(key, list);
    }
  }

  // Credentials each workspace will have after this run, for preferences.
  const credentialed = new Set<string>();

  for (const [key, list] of candidates) {
    const [workspaceId, providerId] = key.split("|") as [string, string];
    const winner = list[0]!;

    if (list.length > 1) {
      credentialConflicts += 1;
      log(
        `Conflict: workspace ${workspaceId}, provider ${providerId}: ${list.length} admins had a key; the earliest was kept.`,
      );
    }

    const existing = await db.workspaceAiCredential.findUnique({
      where: { workspaceId_providerId: { workspaceId, providerId } },
      select: { id: true },
    });
    if (existing) {
      credentialsAlreadyPresent += 1;
      credentialed.add(key);
      continue;
    }

    let keyEnvelope: string;
    try {
      const plaintext = decryptSecret(
        winner.keyEnvelope,
        buildAad({ kind: "user", userId: winner.userId }, winner.providerId),
      );
      keyEnvelope = encryptSecret(
        plaintext,
        buildAad({ kind: "workspace", workspaceId }, providerId),
      );
    } catch {
      unreadable += 1;
      continue;
    }

    if (dryRun) {
      credentialsCopied += 1;
      credentialed.add(key);
      continue;
    }

    try {
      await db.workspaceAiCredential.create({
        data: {
          workspaceId,
          providerId,
          label: winner.label,
          keyEnvelope,
          keyId: keyEnvelope.split(".")[1] ?? "",
          keyFingerprint: winner.keyFingerprint,
          maskedPreview: winner.maskedPreview,
          verifiedKinds: winner.validatedAt ? ["text"] : [],
          validatedAt: winner.validatedAt,
          lastUsedAt: winner.lastUsedAt,
          createdById: winner.userId,
        },
      });
      credentialsCopied += 1;
      credentialed.add(key);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Created by a concurrent run between the check and the insert.
      credentialsAlreadyPresent += 1;
      credentialed.add(key);
    }
  }

  // Slots a dry run has claimed, since it writes nothing for the next lookup to find.
  const plannedPreferences = new Set<string>();
  let preferencesCopied = 0;
  let preferencesAlreadyPresent = 0;
  let preferencesWithoutCredential = 0;

  // Preferences are visited oldest first, so when two admins of a workspace
  // disagree the earlier choice is the one that lands.
  for (const preference of preferences) {
    const targets = workspacesByUser.get(preference.userId) ?? [];
    for (const workspaceId of targets) {
      const existing = await db.workspaceAiPreference.findUnique({
        where: {
          workspaceId_feature: { workspaceId, feature: preference.feature },
        },
        select: { id: true },
      });
      const slot = `${workspaceId}|${preference.feature}`;
      if (existing || plannedPreferences.has(slot)) {
        preferencesAlreadyPresent += 1;
        continue;
      }
      const hasKey =
        credentialed.has(`${workspaceId}|${preference.providerId}`) ||
        (await db.workspaceAiCredential.findUnique({
          where: {
            workspaceId_providerId: {
              workspaceId,
              providerId: preference.providerId,
            },
          },
          select: { id: true },
        })) !== null;
      if (!hasKey) {
        preferencesWithoutCredential += 1;
        continue;
      }
      if (dryRun) {
        plannedPreferences.add(slot);
        preferencesCopied += 1;
        continue;
      }
      try {
        await db.workspaceAiPreference.create({
          data: {
            workspaceId,
            feature: preference.feature,
            providerId: preference.providerId,
            modelId: preference.modelId,
            modelSource: preference.modelSource,
            modelCapabilities: preference.modelCapabilities,
            updatedById: preference.userId,
          },
        });
        preferencesCopied += 1;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        preferencesAlreadyPresent += 1;
      }
    }
  }

  const report: CopyReport = {
    dryRun,
    sourceCredentials: credentials.length,
    memberOnlySkipped,
    credentialsCopied,
    credentialsAlreadyPresent,
    credentialConflicts,
    unreadable,
    preferencesCopied,
    preferencesAlreadyPresent,
    preferencesWithoutCredential,
  };

  const verb = dryRun ? "would copy" : "copied";
  log(`Mode: ${dryRun ? "dry run (nothing written)" : "write"}`);
  log(`Source credentials examined: ${report.sourceCredentials}`);
  log(`Skipped, user administers no workspace: ${report.memberOnlySkipped}`);
  log(`Credentials ${verb}: ${report.credentialsCopied}`);
  log(`Credentials already present: ${report.credentialsAlreadyPresent}`);
  log(`Conflicts resolved by earliest key: ${report.credentialConflicts}`);
  log(`Unreadable envelopes: ${report.unreadable}`);
  log(`Preferences ${verb}: ${report.preferencesCopied}`);
  log(`Preferences already present: ${report.preferencesAlreadyPresent}`);
  log(`Preferences skipped, no key for the provider: ${report.preferencesWithoutCredential}`);

  return report;
}

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  copyAiCredentialsToWorkspaces({ dryRun }).then(
    async () => {
      await prisma.$disconnect();
      process.exit(0);
    },
    () => {
      // Deliberately not printing the error: a database error can quote the
      // values it was inserting, and those include encrypted key material.
      console.error("The copy failed unexpectedly. Nothing further was written.");
      process.exit(1);
    },
  );
}
