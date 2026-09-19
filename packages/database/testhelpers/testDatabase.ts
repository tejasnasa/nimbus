/**
 * @module database/testhelpers/testDatabase
 * @description The database the schema and migration suites run against.
 *
 * Those suites seed rows and then assert on them, so they must not share a
 * database with the API suite, whose `resetDatabase()` truncates every
 * application table at arbitrary points in its run. Turbo starts both
 * workspaces at once, so a shared database let the API suite delete fixtures
 * out from under a migration test mid-run. Instead of a second server or a
 * second connection string to keep in sync, the database name is swapped in
 * the committed `.env.test` URL — same server, same credentials, physically
 * separate storage.
 */
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// `.env.test` is loaded by `vitest.config.mts` for the workers, but global setup
// runs in the main process, so load it here too. Without `override`, a
// DATABASE_URL that is already in the environment still wins.
dotenv.config({
  path: fileURLToPath(new URL("../../../.env.test", import.meta.url)),
});

/** Name of the database the schema and migration suites own. */
export const TEST_DATABASE_NAME = "nimbus_schema_test";

/** The `DATABASE_URL` from `.env.test`, which the API suite also uses. */
const baseUrl = process.env.DATABASE_URL ?? "";

/**
 * Replaces the database name in a Postgres URL, leaving credentials, host,
 * port and query parameters untouched.
 *
 * @param url - Connection string to rewrite; an empty string stays empty.
 * @param name - Database to point the copy at.
 * @returns The rewritten URL, or `""` when `url` was empty.
 */
function withDatabaseName(url: string, name: string): string {
  if (!url) return "";
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.href;
}

/**
 * The server's default database. Only used to `CREATE DATABASE`; the suites
 * never connect to it.
 */
export const adminDatabaseUrl = withDatabaseName(baseUrl, "postgres");

/** Connection string for the schema and migration suites. */
export const testDatabaseUrl = withDatabaseName(baseUrl, TEST_DATABASE_NAME);

/**
 * Fails unless `url` points at the throwaway stack from `docker-compose.test.yml`.
 *
 * Both suites truncate tables, and global setup additionally issues
 * `CREATE DATABASE`, so a mistyped or exported `DATABASE_URL` must be rejected
 * before either runs.
 *
 * @param url - Connection string about to be used destructively.
 * @throws When the URL is not the local test server.
 */
export function assertThrowawayTestDatabase(url: string): void {
  if (!url.includes(":5434")) {
    throw new Error(
      `Refusing to run destructive tests against "${url}": expected the test database on port 5434.`,
    );
  }
}
