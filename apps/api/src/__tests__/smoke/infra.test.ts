/**
 * @module api/__tests__/smoke/infra
 * @description Infrastructure smoke tests: the test Postgres and Redis from
 * `docker-compose.test.yml` are reachable, and the Prisma schema is applied.
 *
 * These fail first and loudest when the test stack isn't running, so the failure
 * message names the fix.
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeTestResources, testPrisma } from "@testhelpers";
import { pubClient } from "../../lib/redis";

const STACK_HINT =
  "Is the test stack up? Run: docker compose -f docker-compose.test.yml up -d";

describe("api smoke: infra", () => {
  afterAll(closeTestResources);

  it("reaches Postgres", async () => {
    try {
      const rows = await testPrisma.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one`;
      expect(rows[0]?.one).toBe(1);
    } catch (error) {
      throw new Error(`${STACK_HINT}\nCaused by: ${String(error)}`);
    }
  });

  it("has the Prisma schema applied", async () => {
    const tables = await testPrisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const names = tables.map((t) => t.tablename);

    // Mixed casing is intentional: only the better-auth models carry @@map().
    expect(names).toEqual(
      expect.arrayContaining([
        "user",
        "session",
        "account",
        "verification",
        "Workspace",
        "WorkspaceMember",
        "Message",
        "Document",
      ]),
    );
  });

  it("reaches Redis", async () => {
    const pong = await pubClient.ping();
    expect(pong).toBe("PONG");
  });
});
