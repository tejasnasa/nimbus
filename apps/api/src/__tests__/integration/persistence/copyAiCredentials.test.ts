/**
 * @module api/__tests__/integration/persistence/copyAiCredentials
 * @description The one-off script that moves user-scoped AI keys to the
 * workspaces their owners administer, run against the test database only.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMember,
  closeTestResources,
  createUser,
  createWorkspace,
  resetDatabase,
  testPrisma,
} from "@testhelpers";
import {
  buildAad,
  decryptSecret,
  encryptSecret,
} from "../../../lib/ai/credentialCrypto";
import {
  copyAiCredentialsToWorkspaces,
  type CopyReport,
} from "../../../scripts/copyAiCredentialsToWorkspaces";

const KEY_A = "sk-test-fake-key-AAAA1111aaaa";
const KEY_B = "sk-test-fake-key-BBBB2222bbbb";

async function userCredential(
  userId: string,
  providerId: string,
  apiKey: string,
  extra: { createdAt?: Date; validatedAt?: Date | null } = {},
) {
  const keyEnvelope = encryptSecret(
    apiKey,
    buildAad({ kind: "user", userId }, providerId),
  );
  return testPrisma.aiCredential.create({
    data: {
      userId,
      providerId,
      label: "old",
      keyEnvelope,
      keyId: keyEnvelope.split(".")[1] ?? "",
      keyFingerprint: `fp-${apiKey.slice(-6)}`,
      maskedPreview: "sk-…aaaa",
      validatedAt: extra.validatedAt === undefined ? new Date() : extra.validatedAt,
      ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
    },
  });
}

const run = async (dryRun: boolean) => {
  const lines: string[] = [];
  const report = await copyAiCredentialsToWorkspaces(
    { dryRun },
    { log: (l) => lines.push(l) },
  );
  return { report, lines };
};

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeTestResources();
});

describe("copyAiCredentialsToWorkspaces", () => {
  it("copies a key to every workspace the user owns or administers, re-encrypted for each", async () => {
    const user = await createUser();
    const other = await createUser();
    const owned = await createWorkspace(user.id);
    const adminOf = await createWorkspace(other.id);
    await addMember(adminOf.id, user.id, "ADMIN");
    await userCredential(user.id, "openai", KEY_A);

    const { report } = await run(false);

    expect(report.credentialsCopied).toBe(2);
    const rows = await testPrisma.workspaceAiCredential.findMany();
    expect(rows.map((r) => r.workspaceId).sort()).toEqual(
      [owned.id, adminOf.id].sort(),
    );
    for (const row of rows) {
      expect(row.createdById).toBe(user.id);
      expect(row.verifiedKinds).toEqual(["text"]);
      expect(
        decryptSecret(
          row.keyEnvelope,
          buildAad({ kind: "workspace", workspaceId: row.workspaceId }, "openai"),
        ),
      ).toBe(KEY_A);
      // Bound to its own workspace: moving it elsewhere must fail.
      expect(() =>
        decryptSecret(
          row.keyEnvelope,
          buildAad({ kind: "user", userId: user.id }, "openai"),
        ),
      ).toThrow();
    }
  });

  it("skips users who are only members, and counts them", async () => {
    const owner = await createUser();
    const member = await createUser();
    const ws = await createWorkspace(owner.id);
    await addMember(ws.id, member.id, "MEMBER");
    await userCredential(member.id, "openai", KEY_A);

    const { report } = await run(false);

    expect(report.memberOnlySkipped).toBe(1);
    expect(report.credentialsCopied).toBe(0);
    expect(await testPrisma.workspaceAiCredential.count()).toBe(0);
  });

  it("marks an unvalidated source as verified for no kind", async () => {
    const user = await createUser();
    await createWorkspace(user.id);
    await userCredential(user.id, "openai", KEY_A, { validatedAt: null });

    await run(false);

    const row = await testPrisma.workspaceAiCredential.findFirstOrThrow();
    expect(row.verifiedKinds).toEqual([]);
    expect(row.validatedAt).toBeNull();
  });

  it("keeps the earliest key when two admins of one workspace both had one, and reports the conflict", async () => {
    const first = await createUser();
    const second = await createUser();
    const ws = await createWorkspace(first.id);
    await addMember(ws.id, second.id, "ADMIN");
    await userCredential(second.id, "openai", KEY_B, {
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    await userCredential(first.id, "openai", KEY_A, {
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const { report, lines } = await run(false);

    expect(report.credentialConflicts).toBe(1);
    expect(report.credentialsCopied).toBe(1);
    expect(lines.some((l) => l.startsWith("Conflict"))).toBe(true);
    const row = await testPrisma.workspaceAiCredential.findFirstOrThrow();
    expect(row.createdById).toBe(first.id);
    expect(
      decryptSecret(
        row.keyEnvelope,
        buildAad({ kind: "workspace", workspaceId: ws.id }, "openai"),
      ),
    ).toBe(KEY_A);
  });

  it("is idempotent: a second run copies nothing", async () => {
    const user = await createUser();
    await createWorkspace(user.id);
    await userCredential(user.id, "openai", KEY_A);
    await testPrisma.aiFeaturePreference.create({
      data: { userId: user.id, feature: "CHAT", providerId: "openai", modelId: "gpt-5-nano" },
    });

    const first = (await run(false)).report;
    const second = (await run(false)).report;

    expect(first.credentialsCopied).toBe(1);
    expect(first.preferencesCopied).toBe(1);
    expect(second.credentialsCopied).toBe(0);
    expect(second.credentialsAlreadyPresent).toBe(1);
    expect(second.preferencesCopied).toBe(0);
    expect(await testPrisma.workspaceAiCredential.count()).toBe(1);
    expect(await testPrisma.workspaceAiPreference.count()).toBe(1);
  });

  it("never overwrites an existing workspace credential or preference", async () => {
    const user = await createUser();
    const ws = await createWorkspace(user.id);
    await userCredential(user.id, "openai", KEY_A);
    const existing = encryptSecret(
      KEY_B,
      buildAad({ kind: "workspace", workspaceId: ws.id }, "openai"),
    );
    await testPrisma.workspaceAiCredential.create({
      data: {
        workspaceId: ws.id,
        providerId: "openai",
        keyEnvelope: existing,
        keyId: "k",
        keyFingerprint: "fp-existing",
        maskedPreview: "sk-…bbbb",
      },
    });
    await testPrisma.workspaceAiPreference.create({
      data: { workspaceId: ws.id, feature: "CHAT", providerId: "openai", modelId: "gpt-5-mini" },
    });
    await testPrisma.aiFeaturePreference.create({
      data: { userId: user.id, feature: "CHAT", providerId: "openai", modelId: "gpt-5-nano" },
    });

    const { report } = await run(false);

    expect(report.credentialsAlreadyPresent).toBe(1);
    expect(report.preferencesAlreadyPresent).toBe(1);
    const cred = await testPrisma.workspaceAiCredential.findFirstOrThrow();
    expect(cred.keyEnvelope).toBe(existing);
    const pref = await testPrisma.workspaceAiPreference.findFirstOrThrow();
    expect(pref.modelId).toBe("gpt-5-mini");
  });

  it("copies a preference only where the workspace has a key for its provider", async () => {
    const user = await createUser();
    await createWorkspace(user.id);
    await userCredential(user.id, "openai", KEY_A);
    await testPrisma.aiFeaturePreference.createMany({
      data: [
        { userId: user.id, feature: "CHAT", providerId: "openai", modelId: "gpt-5-nano" },
        { userId: user.id, feature: "CANVAS", providerId: "groq", modelId: "llama" },
      ],
    });

    const { report } = await run(false);

    expect(report.preferencesCopied).toBe(1);
    expect(report.preferencesWithoutCredential).toBe(1);
    const prefs = await testPrisma.workspaceAiPreference.findMany();
    expect(prefs.map((p) => p.feature)).toEqual(["CHAT"]);
  });

  it("writes nothing on a dry run but reports what it would do", async () => {
    const user = await createUser();
    await createWorkspace(user.id);
    await userCredential(user.id, "openai", KEY_A);
    await testPrisma.aiFeaturePreference.create({
      data: { userId: user.id, feature: "CHAT", providerId: "openai", modelId: "gpt-5-nano" },
    });

    const { report } = await run(true);

    expect(report.dryRun).toBe(true);
    expect(report.credentialsCopied).toBe(1);
    expect(report.preferencesCopied).toBe(1);
    expect(await testPrisma.workspaceAiCredential.count()).toBe(0);
    expect(await testPrisma.workspaceAiPreference.count()).toBe(0);
  });

  it("counts an unreadable envelope instead of failing the run", async () => {
    const user = await createUser();
    await createWorkspace(user.id);
    await testPrisma.aiCredential.create({
      data: {
        userId: user.id,
        providerId: "openai",
        keyEnvelope: "nimbus1.deadbeef.AAAA.BBBB.CCCC",
        keyId: "deadbeef",
        keyFingerprint: "fp",
        maskedPreview: "sk-…",
      },
    });

    const { report } = await run(false);

    expect(report.unreadable).toBe(1);
    expect(report.credentialsCopied).toBe(0);
  });

  it("prints counts only, never a key, envelope, fingerprint or preview", async () => {
    const first = await createUser();
    const second = await createUser();
    const ws = await createWorkspace(first.id);
    await addMember(ws.id, second.id, "ADMIN");
    await userCredential(first.id, "openai", KEY_A);
    await userCredential(second.id, "openai", KEY_B);

    const { report, lines } = await run(false);
    const output = JSON.stringify({ report, lines });

    for (const secret of [KEY_A, KEY_B, "AAAA1111", "BBBB2222", "nimbus1.", "sk-…aaaa"]) {
      expect(output).not.toContain(secret);
    }
    const _typed: CopyReport = report;
    expect(_typed.dryRun).toBe(false);
  });
});

describe("copyAiCredentialsToWorkspaces: robustness", () => {
  /** A database whose creates fail with `error`, everything else real. */
  const failingCreates = (error: unknown) =>
    ({
      aiCredential: testPrisma.aiCredential,
      aiFeaturePreference: testPrisma.aiFeaturePreference,
      workspaceMember: testPrisma.workspaceMember,
      workspaceAiCredential: {
        findUnique: testPrisma.workspaceAiCredential.findUnique.bind(
          testPrisma.workspaceAiCredential,
        ),
        create: async () => {
          throw error;
        },
      },
      workspaceAiPreference: {
        findUnique: testPrisma.workspaceAiPreference.findUnique.bind(
          testPrisma.workspaceAiPreference,
        ),
        create: async () => {
          throw error;
        },
      },
    }) as never;

  it("treats a unique violation from a concurrent run as already present", async () => {
    const user = await createUser();
    await createWorkspace(user.id);
    await userCredential(user.id, "openai", KEY_A);

    const report = await copyAiCredentialsToWorkspaces(
      { dryRun: false },
      { db: failingCreates({ code: "P2002" }), log: () => {} },
    );

    expect(report.credentialsCopied).toBe(0);
    expect(report.credentialsAlreadyPresent).toBe(1);
  });

  it("rethrows any other database error without writing", async () => {
    const user = await createUser();
    await createWorkspace(user.id);
    await userCredential(user.id, "openai", KEY_A);

    await expect(
      copyAiCredentialsToWorkspaces(
        { dryRun: false },
        { db: failingCreates(new Error("boom")), log: () => {} },
      ),
    ).rejects.toThrow("boom");
    expect(await testPrisma.workspaceAiCredential.count()).toBe(0);
  });

  it("prints through the console and uses the shared client when given no dependencies", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = await copyAiCredentialsToWorkspaces({ dryRun: true });
      expect(report.dryRun).toBe(true);
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain("nimbus1.");
    } finally {
      log.mockRestore();
    }
  });
});
