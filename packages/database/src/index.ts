/**
 * @module database
 * @description Barrel export for `@nimbus/db`.
 *
 * Exposes the prisma singleton plus all generated model types from the
 * CJS-compiled Prisma client. Consumers should always import `prisma` from
 * here rather than instantiating their own client.
 */

export { prisma, createPrismaClient } from "./client"; // prisma instance + test-scoped factory
export * from "./generated/prisma/client"; // exports generated types from prisma
