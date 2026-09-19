/**
 * @module database/client
 * @description Prisma client singleton shared by the API and web apps.
 *
 * Instantiates PrismaClient with the `@prisma/adapter-pg` driver adapter backed
 * by an explicit pg Pool (max 10 connections). The schema's generator is
 * configured for the pg adapter — a bare `new PrismaClient()` without the
 * adapter will not work.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import pg from "pg";

/**
 * Creates an independent Prisma client with its own connection pool.
 *
 * Use this instead of the {@link prisma} singleton when a caller must target a
 * specific database — notably tests, which point at a throwaway test database
 * and need a pool they can close without disturbing the singleton.
 *
 * @param connectionString - Postgres URL; defaults to `process.env.DATABASE_URL`.
 * @returns A PrismaClient with its own pg Pool (max 10 connections).
 */
export const createPrismaClient = (connectionString?: string) => {
  const pool = new pg.Pool({
    connectionString: connectionString ?? process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  return new PrismaClient({
    adapter: new PrismaPg(pool),
  });
};

// Cache on globalThis so Next.js HMR doesn't open a new connection pool
// on every hot reload. Skipped in production where each process starts once.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
