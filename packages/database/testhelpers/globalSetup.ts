/**
 * @module database/testhelpers/globalSetup
 * @description Prepares the schema-test database before any suite runs.
 *
 * Vitest runs this once in the main process, ahead of the workers, so the
 * database exists and is migrated by the time a suite opens a connection. Both
 * steps are idempotent, which keeps repeated local runs cheap and lets a CI job
 * call the suite without a separate deploy step.
 *
 * `prisma migrate deploy` is used rather than creating tables by hand: the
 * suites assert on `prisma migrate status` and on the `_prisma_migrations`
 * ledger, so the migration history has to be real.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  TEST_DATABASE_NAME,
  adminDatabaseUrl,
  assertThrowawayTestDatabase,
  testDatabaseUrl,
} from "./testDatabase";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** SQLSTATE Postgres raises when `CREATE DATABASE` targets an existing name. */
const DUPLICATE_DATABASE = "42P04";

/**
 * Creates the schema-test database unless it is already there.
 *
 * `CREATE DATABASE` has no `IF NOT EXISTS`, and another run of the same suite
 * can commit one between the catalog lookup and the statement, so a duplicate
 * error means someone else did the work and is treated as success.
 */
async function ensureDatabaseExists(): Promise<void> {
  const client = new pg.Client({ connectionString: adminDatabaseUrl });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [TEST_DATABASE_NAME],
    );
    if (existing.rowCount === 0) {
      try {
        await client.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
      } catch (error) {
        if ((error as { code?: string }).code !== DUPLICATE_DATABASE) throw error;
      }
    }
  } finally {
    await client.end();
  }
}

/**
 * Applies every pending migration to the schema-test database.
 *
 * The URL is passed through the child's environment because `prisma.config.ts`
 * reads `DATABASE_URL`. It has to be set here: the inherited value points at
 * the API suite's database, and a bare `prisma migrate deploy` would migrate
 * that one and leave this suite without a schema.
 */
function applyMigrations(): void {
  const url = testDatabaseUrl;
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: packageRoot,
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      shell: true,
      timeout: 180_000,
    });
  } catch (error) {
    const output = (error as { stdout?: string | Buffer }).stdout ?? "";
    throw new Error(
      `prisma migrate deploy failed against ${url}:\n${output.toString()}`,
      { cause: error },
    );
  }
}

/**
 * Vitest global setup hook: makes the schema-test database present and current.
 */
export default async function setup(): Promise<void> {
  assertThrowawayTestDatabase(testDatabaseUrl);
  await ensureDatabaseExists();
  applyMigrations();
}
