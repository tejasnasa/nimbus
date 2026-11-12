/**
 * @module testhelpers/database
 * @description Test-scoped Postgres and Redis fixtures.
 *
 * Integration and socket tests run against a real database (never an in-memory
 * substitute — the `userId_workspaceId` compound unique and Prisma's own
 * behaviours must be exercised for real). `resetDatabase()` gives each test a
 * clean slate deterministically, instead of relying on transaction rollback,
 * which is unreliable once Socket.IO's async hops own the connection.
 */
import { createPrismaClient } from "@nimbus/db";
import { ensureBotUser } from "../src/lib/botUser";
import { pubClient } from "../src/lib/redis";

/** Dedicated client for the test database: its own pool, independently closable. */
export const testPrisma = createPrismaClient(process.env.DATABASE_URL);

/**
 * Re-creates the NimbusBot user row, if `BOT_USERID` is configured.
 *
 * Truncation wipes it, and `createWorkspace` needs it for the bot's membership
 * foreign key. The upsert is the same one the server runs at boot, so the tests
 * and production share one implementation.
 */
const seedBotUser = async () => {
  if (!process.env.BOT_USERID) return;
  await ensureBotUser(testPrisma);
};

/** Attempts at the truncate before a deadlock is reported. */
const TRUNCATE_ATTEMPTS = 5;

/**
 * Runs the truncate, retrying when Postgres picks it as a deadlock victim.
 *
 * Socket handlers run detached, so a test can finish while its handler is still
 * writing (a refusal's bookkeeping, say). The next test's truncate then waits
 * on those row locks while the writer waits on the truncate's table locks, and
 * Postgres aborts one of them. When that is the truncate, it is safe to run
 * again a moment later, once the writer has finished.
 */
const truncateRetryingDeadlocks = async (sql: string) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await testPrisma.$executeRawUnsafe(sql);
      return;
    } catch (error) {
      const deadlocked = String(
        (error as { message?: unknown })?.message,
      ).includes("40P01");
      if (!deadlocked || attempt >= TRUNCATE_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
};

/**
 * Truncates every application table, resetting identity sequences, then flushes
 * Redis so presence/voice rosters don't leak across tests.
 *
 * Prisma's own migration bookkeeping table is deliberately skipped.
 */
export const resetDatabase = async () => {
  const rows = await testPrisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\_prisma%'
  `;

  if (rows.length > 0) {
    const targets = rows.map((row) => `"public"."${row.tablename}"`).join(", ");
    await truncateRetryingDeadlocks(
      `TRUNCATE TABLE ${targets} RESTART IDENTITY CASCADE`,
    );
  }

  await pubClient.flushdb();
  await seedBotUser();
};

/** Releases the pools/sockets opened by the fixtures. Call from `afterAll`. */
export const closeTestResources = async () => {
  await testPrisma.$disconnect();
  // `quit` rather than `disconnect` so the Redis connection closes gracefully.
  if (pubClient.status !== "end") await pubClient.quit();
};
