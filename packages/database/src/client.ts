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

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

const adapter = new PrismaPg(pool);

// Cache on globalThis so Next.js HMR doesn't open a new connection pool
// on every hot reload. Skipped in production where each process starts once.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
