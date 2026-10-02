/**
 * @module api/scripts/seed_smoke_users
 * @description Creates — or repairs — the two accounts the production smoke
 * suite signs in as, marking both email-verified. That flag is the one thing a
 * mailbox would otherwise be needed for, because auth runs with
 * `requireEmailVerification` and there is no admin endpoint to set it.
 *
 * @important Non-destructive. There is no truncate here, no delete, and no
 *            update outside the rows belonging to the two addresses below. The
 *            failure that matters is running it against the wrong database, so
 *            it refuses to touch the throwaway test stack and will not write
 *            anything at all without an explicit `SMOKE_SEED_CONFIRM=yes`.
 *            Run it with no environment override first: that is a read-only
 *            report of what it would do.
 *
 * @important Passwords are hashed with better-auth's own hasher. A hand-rolled
 *            digest produces an account that cannot sign in, and the resulting
 *            failure looks like an application bug rather than a seeding bug.
 *
 * Usage:
 *   npx tsx scripts/seed_smoke_users.ts                      # report only
 *   SMOKE_SEED_CONFIRM=yes npx tsx scripts/seed_smoke_users.ts
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

// The repo root `.env` is the deployment's own configuration. `dotenv` does not
// override variables already set, so an explicit DATABASE_URL on the command
// line still wins.
dotenv.config({ path: resolve(repoRoot, ".env") });

/** The accounts to provision, in the order the smoke suite expects them. */
const ACCOUNTS = [
  {
    label: "owner",
    name: "Smoke Owner",
    email: process.env.SMOKE_USER_EMAIL ?? "smoke1@smoke.com",
    emailVar: "SMOKE_USER_EMAIL",
    passwordVar: "SMOKE_USER_PASSWORD",
  },
  {
    label: "member",
    name: "Smoke Member",
    email: process.env.SMOKE_MEMBER_EMAIL ?? "smoke2@smoke.com",
    emailVar: "SMOKE_MEMBER_EMAIL",
    passwordVar: "SMOKE_MEMBER_PASSWORD",
  },
] as const;

/**
 * Refuses targets that are obviously not the deployment.
 *
 * @throws If DATABASE_URL is missing, or points at the test stack.
 */
const assertRealTarget = (): string => {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }

  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const isTestPort = url.port === "5434";

  if (isLoopback || isTestPort) {
    throw new Error(
      `Refusing to run: DATABASE_URL points at ${url.hostname}:${url.port}, ` +
        "which is the throwaway test stack — seeding it would not provision " +
        "the deployed accounts the smoke suite signs in as.",
    );
  }

  return `${url.hostname}:${url.port || "(default)"}${url.pathname}`;
};

/** Never printed in full; enough to eyeball that a value was set. */
const mask = (value: string): string =>
  value.length <= 6 ? "*".repeat(value.length) : `${value.slice(0, 3)}***${value.slice(-2)}`;

async function main() {
  const target = assertRealTarget();
  const confirmed = process.env.SMOKE_SEED_CONFIRM === "yes";

  // Imported after `dotenv.config` above: these modules read `process.env` as
  // they initialise, and `tsx` compiles this file as CommonJS, where the
  // imports cannot be hoisted above the config call either.
  //
  // Deliberately NOT `../src/lib/auth`: that pulls in the whole auth config,
  // which validates every required environment variable at import time and
  // opens Redis connections this script has no use for. `better-auth/crypto` is
  // the same hasher the auth instance uses — `auth.ts` does not override
  // password hashing — with none of that.
  const { prisma } = await import("@nimbus/db");
  const { hashPassword } = await import("better-auth/crypto");

  console.log(`Target database: ${target}`);
  console.log(confirmed ? "Mode: WRITE" : "Mode: report only (set SMOKE_SEED_CONFIRM=yes to write)");
  console.log("");

  /** Values to write into `.env.smoke` for local runs, when newly generated. */
  const generated: Record<string, string> = {};

  for (const account of ACCOUNTS) {
    const existing = await prisma.user.findUnique({
      where: { email: account.email },
    });

    const credential = existing
      ? await prisma.account.findFirst({
          where: { userId: existing.id, providerId: "credential" },
        })
      : null;

    const plan = existing
      ? credential
        ? existing.emailVerified
          ? "already provisioned — nothing to do"
          : "exists, needs emailVerified"
        : "exists, needs a credential row"
      : "will be created";

    console.log(`${account.email} (${account.label}): ${plan}`);

    if (!confirmed) continue;

    // A password is only needed when there is no credential row to keep. An
    // existing account's password is deliberately left alone rather than
    // reset on every run.
    let password = process.env[account.passwordVar];
    let passwordIsNew = false;

    if (!credential && !password) {
      password = `Smoke-${randomBytes(24).toString("base64url")}`;
      passwordIsNew = true;
    }

    const userId = existing
      ? existing.id
      : (
          await prisma.user.create({
            data: {
              id: randomUUID(),
              email: account.email,
              name: account.name,
              emailVerified: true,
            },
          })
        ).id;

    if (existing && !existing.emailVerified) {
      await prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true },
      });
    }

    // `Account` has no unique constraint on (providerId, accountId), so a
    // blind create would duplicate on a second run. Checking first is what
    // makes this re-runnable.
    if (!credential) {
      await prisma.account.create({
        data: {
          id: randomUUID(),
          userId,
          providerId: "credential",
          accountId: userId,
          password: await hashPassword(password!),
        },
      });
    }

    if (passwordIsNew) generated[account.passwordVar] = password!;

    console.log(
      `  -> verified${credential ? "" : ", credential created"}` +
        (passwordIsNew ? `, generated password ${mask(password!)}` : ""),
    );
  }

  if (confirmed && Object.keys(generated).length > 0) {
    const envPath = resolve(repoRoot, ".env.smoke");

    if (existsSync(envPath)) {
      console.log(
        `\n${envPath} already exists — left untouched. Generated passwords were ` +
          "printed masked above and cannot be recovered; re-run with an " +
          "explicit password variable to set a known one.",
      );
    } else {
      const lines = [
        "# Credentials for the production smoke suite. Gitignored — do not commit.",
        "SMOKE_BASE_URL=https://nimbus.tejasnasa.me",
        "SMOKE_API_URL=https://nimbus-api.tejasnasa.me",
        ...ACCOUNTS.flatMap((account) => [
          `${account.emailVar}=${account.email}`,
          `${account.passwordVar}=${generated[account.passwordVar] ?? ""}`,
        ]).filter((line) => !line.endsWith("=")),
        "",
      ];
      writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
      console.log(`\nWrote ${envPath} with the generated passwords (mode 600).`);
      console.log("Copy those values into repository secrets for the nightly run.");
    }
  }

  // The Prisma pool holds the process open if it is not closed.
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
