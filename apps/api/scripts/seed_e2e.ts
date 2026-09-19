/**
 * @module api/scripts/seed_e2e
 * @description Seeds the deterministic fixtures the Playwright suite depends on:
 * two verified users and one workspace owned by the first with the second as a
 * MEMBER, plus the CANVAS and MARKDOWN documents workspace creation normally
 * seeds.
 *
 * Invoked by `apps/web/e2e/global-setup.ts` before the browsers start. The result
 * is written to `apps/web/e2e/.auth/e2e-state.json` so specs can drive two
 * authenticated sessions against known ids.
 *
 * @important This script TRUNCATEs every application table in the database named
 *            by `DATABASE_URL`. It loads `.env.test` explicitly, and because
 *            `dotenv` reads that file *instead of* the default `.env`, it cannot
 *            reach a production database. Do not "simplify" the env loading.
 *
 * @important Passwords are hashed through better-auth's own hasher. A hand-rolled
 *            digest silently fails to sign in, and the resulting failure looks
 *            like an application bug rather than a fixture bug.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

// Loading this path *replaces* the default `.env`, which is what keeps the suite
// off any real database. `dotenv` will not override variables already set in the
// environment, so callers can still target a different stack if they must.
dotenv.config({ path: resolve(repoRoot, ".env.test") });

// The Redis client assumes TLS unless told otherwise, and a TLS handshake against
// the plaintext test container hangs without ever emitting an `error` event — the
// seed would sit there forever rather than fail. `.env.test` does not set this, so
// it is defaulted here, before any module that opens a Redis connection loads.
process.env.REDIS_TLS ??= "false";

/** Credentials shared by the suite; the two users differ only by identity. */
const PASSWORD = "E2E-Password-123!";
const USERS = [
  { key: "owner", name: "E2E Owner", email: "e2e-owner@example.test" },
  { key: "member", name: "E2E Member", email: "e2e-member@example.test" },
] as const;

async function main() {
  // Imported here rather than at the top of the file: these modules read
  // `process.env` as they initialise, so `dotenv.config` above must have run
  // first. `tsx` also compiles this file as CommonJS, where top-level `await`
  // is a syntax error, so the imports cannot be hoisted either.
  const { prisma } = await import("@nimbus/db");
  const { auth } = await import("../src/lib/auth");
  const { subClient } = await import("../src/lib/redis");
  const { resetDatabase, closeTestResources, testPrisma } = await import(
    "../testhelpers/database"
  );

  /** Hashes with better-auth's own hasher, so the digest matches a real sign-up. */
  const hashPassword = async (password: string): Promise<string> =>
    (await auth.$context).password.hash(password);

  const botUserId = process.env.BOT_USERID;
  if (!botUserId) {
    throw new Error(
      "BOT_USERID must be set — workspace creation inserts NimbusBot as a member.",
    );
  }

  await resetDatabase();

  const passwordHash = await hashPassword(PASSWORD);
  const created: Record<string, { id: string; email: string }> = {};

  for (const spec of USERS) {
    // `User.id` has no Prisma-level default, so ids are generated here in the
    // same shape better-auth uses.
    const user = await testPrisma.user.create({
      data: {
        id: randomUUID(),
        email: spec.email,
        name: spec.name,
        emailVerified: true,
      },
    });

    // Credentials live on `Account`. `Account` has no unique constraint on
    // (providerId, accountId), so a plain create is the only option here; the
    // table was just truncated, so there is nothing to collide with.
    await testPrisma.account.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: passwordHash,
      },
    });

    created[spec.key] = { id: user.id, email: user.email };
  }

  const owner = created.owner!;
  const member = created.member!;

  const workspace = await testPrisma.workspace.create({
    data: {
      name: "E2E Workspace",
      description: "Workspace created by the end-to-end seed script.",
      slug: "e2e-workspace",
      inviteCode: "E2E-INVITE-CODE",
      members: {
        create: [
          { userId: owner.id, role: "OWNER" },
          { userId: member.id, role: "MEMBER" },
          { userId: botUserId, role: "ADMIN" },
        ],
      },
      documents: {
        create: [
          { title: "E2E Canvas", type: "CANVAS" },
          { title: "E2E Document", type: "MARKDOWN" },
        ],
      },
    },
    include: { documents: true },
  });

  const canvas = workspace.documents.find(d => d.type === "CANVAS")!;
  const markdown = workspace.documents.find(d => d.type === "MARKDOWN")!;

  const state = {
    password: PASSWORD,
    users: { owner, member },
    workspace: {
      id: workspace.id,
      // `slugId` is the autoincrement int the app routes by; read it back rather
      // than guessing.
      slugId: workspace.slugId,
      inviteCode: workspace.inviteCode,
      canvasDocumentId: canvas.id,
      markdownDocumentId: markdown.id,
    },
  };

  const outDir = resolve(repoRoot, "apps/web/e2e/.auth");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, "e2e-state.json"),
    JSON.stringify(state, null, 2),
  );

  console.log(
    `Seeded ${USERS.length} users and workspace #${workspace.slugId} with ${workspace.documents.length} documents.`,
  );

  // Every open handle has to be closed or the process hangs instead of exiting.
  // `closeTestResources` covers the test fixture's own pool and the Redis publish
  // client; the subscriber and the `@nimbus/db` singleton pool are reachable only
  // because importing the auth instance initialises them.
  await closeTestResources();
  await subClient.quit();
  await prisma.$disconnect();
}

// `.catch` rather than top-level `await`: see the import note in `main`.
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
