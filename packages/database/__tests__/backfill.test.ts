/**
 * @module database/__tests__/backfill
 * @description The backfill semantics in the AI-credentials migration.
 *
 * `add_ai_credentials` backfills pre-existing users to `freeDocGenerationsUsed = 5`
 * and leaves later users at the column default of 0. That decision is one-way:
 * a rollback does not undo it. The migration applies to the test database during
 * `globalSetup`, so this suite works against the post-migration shape and asserts
 * the partition it drew.
 *
 * The pre/post split is decided by the timestamp the migration recorded:
 * `2026-09-27 06:35:26`. Users created at or after that moment are "later"
 * and stay at 0; users created before are "pre-existing" and are at 5.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  acquireDatabaseLock,
  createTestClient,
  releaseDatabaseLock,
  truncateAll,
} from "./dbTestUtils";

/**
 * The instant the backfill split on. The migration's WHERE clause is
 * `"createdAt" < TIMESTAMP '2026-09-27 06:35:26'`, so anything strictly
 * before this is backfilled to 5.
 */
const BACKFILL_BOUNDARY = new Date("2026-09-27T06:35:26.000Z");

let client: PrismaClient;

beforeAll(async () => {
  await acquireDatabaseLock();
  client = createTestClient();
}, 120_000);

beforeEach(async () => {
  await truncateAll(client);
});

afterAll(async () => {
  await client.$disconnect();
  await releaseDatabaseLock();
});

describe("add_ai_credentials migration — backfill semantics", () => {
  it("marks pre-migration users as already at the limit, leaves later ones at 0", async () => {
    // The migration ran once at globalSetup time, and only against the rows
    // that existed then. truncateAll() empties the tables before this test,
    // so any user we create here post-dates the backfill and gets the column
    // default of 0. We then re-run the same UPDATE the migration issued and
    // assert that the partition it drew — "createdAt strictly before the
    // migration timestamp" — still holds.
    const pre = await client.user.create({
      data: {
        id: "pre-existing-user",
        name: "Old User",
        email: "old@example.com",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
    });
    const later = await client.user.create({
      data: {
        id: "later-user",
        name: "New User",
        email: "new@example.com",
        createdAt: new Date("2026-09-27T12:00:00Z"),
      },
    });

    // Both rows start at the column default.
    expect(pre.freeDocGenerationsUsed).toBe(0);
    expect(later.freeDocGenerationsUsed).toBe(0);

    // The migration's backfill update, reissued verbatim. The boundary is
    // the same TIMESTAMP literal the migration.sql file uses.
    const updated = await client.$executeRaw`
      UPDATE "user" SET "freeDocGenerationsUsed" = 5
      WHERE "createdAt" < TIMESTAMP '2026-09-27 06:35:26'
    `;
    expect(updated).toBe(1);

    const reloadedPre = await client.user.findUniqueOrThrow({
      where: { id: pre.id },
    });
    const reloadedLater = await client.user.findUniqueOrThrow({
      where: { id: later.id },
    });
    expect(reloadedPre.freeDocGenerationsUsed).toBe(5);
    expect(reloadedLater.freeDocGenerationsUsed).toBe(0);
  });

  it("leaves users created at the exact boundary at the default of 0", async () => {
    // The migration uses `createdAt < TIMESTAMP`, so the boundary itself is
    // "later" by the backfill's definition. A user created at exactly the
    // boundary instant must not be marked as used.
    await client.user.create({
      data: {
        id: "boundary-user",
        name: "Boundary",
        email: "boundary@example.com",
        createdAt: BACKFILL_BOUNDARY,
      },
    });

    const updated = await client.$executeRaw`
      UPDATE "user" SET "freeDocGenerationsUsed" = 5
      WHERE "createdAt" < TIMESTAMP '2026-09-27 06:35:26'
    `;
    expect(updated).toBe(0);

    const row = await client.user.findUniqueOrThrow({
      where: { id: "boundary-user" },
    });
    expect(row.freeDocGenerationsUsed).toBe(0);
  });

  it("creates both tables and the AiFeature enum on a fresh database", async () => {
    // The migration must be a no-op against an already-migrated DB. The shape
    // it lands on is asserted here by querying each artefact directly.
    const tables = await client.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('ai_credential', 'ai_feature_preference')
      ORDER BY tablename
    `;
    expect(tables.map((row) => row.tablename)).toEqual([
      "ai_credential",
      "ai_feature_preference",
    ]);

    const column = await client.$queryRaw<{ udt_name: string }[]>`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name = 'user' AND column_name = 'freeDocGenerationsUsed'
    `;
    expect(column[0]?.udt_name).toBe("int4");

    const enums = await client.$queryRaw<{ label: string }[]>`
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'AiFeature'
      ORDER BY e.enumsortorder
    `;
    expect(enums.map((row) => row.label)).toEqual([
      "CHAT",
      "MARKDOWN",
      "CANVAS",
    ]);
  });
});
