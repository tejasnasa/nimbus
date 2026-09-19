/**
 * @module database/__tests__/dbTestUtils
 * @description Shared plumbing for the suites that run against the real test database.
 *
 * `testDatabaseUrl` is the throwaway Postgres on port 5434 from `.env.test`,
 * with the database name swapped so these suites own their rows instead of
 * sharing them with the API suite. Every suite here truncates tables between
 * tests, so the URL is validated before a client is handed out — pointing these
 * tests at a developer database by accident would destroy its contents.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createPrismaClient } from "../src/client";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  assertThrowawayTestDatabase,
  testDatabaseUrl,
} from "../testhelpers/testDatabase";

export { testDatabaseUrl };

/** Tables in FK-safe truncation order (CASCADE makes the order irrelevant). */
const TABLES = [
  '"Document"',
  '"Message"',
  '"WorkspaceMember"',
  '"Workspace"',
  '"session"',
  '"account"',
  '"verification"',
  '"user"',
] as const;

/**
 * Creates a client bound to the test database.
 *
 * @throws When `testDatabaseUrl` does not look like the test stack.
 */
export function createTestClient(): PrismaClient {
  assertThrowawayTestDatabase(testDatabaseUrl);
  return createPrismaClient(testDatabaseUrl);
}

/** Empties every application table and resets the `slugId` sequence. */
export async function truncateAll(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`,
  );
}

/**
 * Vitest runs test files in parallel and they all share one database, so a
 * file that truncates between tests would pull the rows out from under a
 * sibling file. Suites that reset the database take this advisory lock for
 * their whole run, which serialises them against each other.
 *
 * The lock lives on a dedicated single-connection pool: a session-level
 * advisory lock belongs to the session that took it, so it must not be handed
 * back to a shared pool mid-test.
 */
const LOCK_KEY = 5_123_456_789;
let lockPool: pg.Pool | undefined;

/** Blocks until no other suite holds the database lock. */
export async function acquireDatabaseLock(): Promise<void> {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
  try {
    await pool.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  } catch (error) {
    await pool.end();
    throw error;
  }
  lockPool = pool;
}

/** Releases the lock taken by {@link acquireDatabaseLock}. */
export async function releaseDatabaseLock(): Promise<void> {
  if (!lockPool) return;
  await lockPool.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  await lockPool.end();
  lockPool = undefined;
}

/** Creates a user with a collision-free id and email. */
export async function createUser(
  client: PrismaClient,
  overrides: { name?: string; email?: string } = {},
) {
  const id = `user_${randomUUID().slice(0, 8)}`;
  return client.user.create({
    data: {
      id,
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `${id}@example.com`,
    },
  });
}

/** Creates a workspace with a collision-free invite code. */
export async function createWorkspace(
  client: PrismaClient,
  overrides: { name?: string; slug?: string; inviteCode?: string } = {},
) {
  return client.workspace.create({
    data: {
      name: overrides.name ?? "Test Workspace",
      slug: overrides.slug ?? `test-workspace-${randomUUID().slice(0, 8)}`,
      inviteCode: overrides.inviteCode ?? `invite_${randomUUID()}`,
    },
  });
}

/** Error shape Prisma throws for constraint violations. */
export interface PrismaConstraintError extends Error {
  code: string;
  meta?: Record<string, unknown>;
}

/**
 * Runs `operation` and returns the Prisma error it must reject with.
 *
 * @param operation - The write expected to violate a database constraint.
 * @param code - Expected Prisma error code, e.g. `P2002`.
 * @returns The caught error, so callers can inspect `meta`.
 */
export async function capturePrismaError(
  operation: () => Promise<unknown>,
  code: string,
): Promise<PrismaConstraintError> {
  try {
    await operation();
  } catch (error) {
    const failure = error as PrismaConstraintError;
    if (failure.code !== code) {
      throw new Error(
        `Expected Prisma error ${code} but got ${failure.code}: ${failure.message}`,
      );
    }
    return failure;
  }
  throw new Error(`Expected the operation to fail with ${code}, but it succeeded`);
}
