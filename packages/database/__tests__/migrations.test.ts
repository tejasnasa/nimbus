import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import { createTestClient, testDatabaseUrl } from "./dbTestUtils";

/**
 * Proves the database the suites run against is fully migrated.
 *
 * The schema file and the generated client can both be current while the
 * server still sits on an older shape; `prisma migrate status` and the
 * `_prisma_migrations` ledger are the only things that can tell us otherwise.
 */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = fileURLToPath(new URL("../prisma/migrations", import.meta.url));

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  logs: string | null;
}

let client: PrismaClient;

beforeAll(() => {
  client = createTestClient();
});

afterAll(async () => {
  await client.$disconnect();
});

/** Migration folder names on disk, which Prisma records as migration_name. */
const localMigrations = () =>
  readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

describe("prisma migrate status", () => {
  // `npx prisma` boots a whole CLI before it reaches the database, so it is slow
  // even when idle and slower still under a full `turbo run test`, where the
  // other workspaces are competing for the CPU. The default 5s test timeout
  // measures the spawn, not the assertion, and fails intermittently; the 120s
  // allowance below matches the subprocess timeout the call already passes.
  it(
    "reports the test database as up to date",
    () => {
      const output = execFileSync("npx", ["prisma", "migrate", "status"], {
        cwd: packageRoot,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        encoding: "utf8",
        shell: true,
        timeout: 120_000,
      }).toLowerCase();

      expect(output).toContain("up to date");
      expect(output).not.toContain("have not yet been applied");
      expect(output).not.toContain("following migration");
      expect(output).not.toContain("failed");
    },
    120_000,
  );
});

describe("_prisma_migrations ledger", () => {
  it("records every migration present in prisma/migrations", async () => {
    const rows = await client.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at, logs
      FROM _prisma_migrations
      ORDER BY migration_name
    `;

    expect(rows.map((row) => row.migration_name)).toEqual(localMigrations());
  });

  it("has applied every recorded migration successfully", async () => {
    const rows = await client.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at, logs
      FROM _prisma_migrations
      ORDER BY migration_name
    `;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.finished_at, `${row.migration_name} never finished`).not.toBeNull();
      expect(row.rolled_back_at, `${row.migration_name} was rolled back`).toBeNull();
      expect(row.logs ?? "").toBe("");
    }
  });

  it("covers the workspace, canvas and markdown migrations the app depends on", async () => {
    const rows = await client.$queryRaw<MigrationRow[]>`
      SELECT migration_name FROM _prisma_migrations ORDER BY migration_name
    `;
    const applied = rows.map((row) => row.migration_name).join("\n");

    expect(applied).toMatch(/add_invitation_code/);
    expect(applied).toMatch(/add_markdown_using_yjs/);
    expect(applied).toMatch(/add_initial_content/);
  });
});

describe("schema is reachable from the generated client", () => {
  it("serves every model the application imports", async () => {
    const counts = await Promise.all([
      client.user.count(),
      client.session.count(),
      client.account.count(),
      client.verification.count(),
      client.workspace.count(),
      client.workspaceMember.count(),
      client.message.count(),
      client.document.count(),
    ]);
    for (const count of counts) expect(count).toBeGreaterThanOrEqual(0);
  });
});
