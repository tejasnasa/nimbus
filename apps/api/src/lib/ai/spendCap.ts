/**
 * @module api/lib/ai/spendCap
 * @description The workspace's monthly spend cap: how much its own keys have
 * cost so far this UTC month, and whether that has reached the ceiling an admin
 * set.
 *
 * Spend is summed from the call log (`AiCall.costUsd`) over calls paid by the
 * workspace's own keys. The sum is cached in Redis for 30 seconds under
 * `spend:<workspaceId>:<yyyy-mm>`, so a burst of chat messages costs one
 * aggregate query rather than one per message.
 *
 * @important The cap is a soft ceiling, not a meter. Three things keep it from
 *            being exact, and the settings UI says so: the cache can be 30 s
 *            behind; a call that is already running when the cap is reached
 *            finishes; and a call whose model has no price counts as zero.
 *            Free-tier calls are not counted: they spend the operator's money,
 *            bounded by per-user quotas, and counting them would block members
 *            who spent nothing of the workspace's.
 */
import { prisma } from "@nimbus/db";
import { pubClient } from "../redis";
import { readWorkspaceAiSettings } from "./workspaceSettings";

/** How long a computed month-to-date sum is reused. */
export const SPEND_CACHE_TTL_SECONDS = 30;

/** Collaborators the cap functions read. Defaults to the live ones. */
export type SpendCapDeps = {
  readonly db?: typeof prisma;
  readonly redis?: Pick<typeof pubClient, "get" | "set">;
  /** The clock. Tests pin it to exercise the month boundary. */
  readonly now?: () => Date;
};

/** `yyyy-mm` of an instant, in UTC. */
export function monthKey(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The first instant of the UTC month containing `at`. */
export function monthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** The Redis key for one workspace's month-to-date sum. */
export const spendCacheKey = (workspaceId: string, at: Date): string =>
  `spend:${workspaceId}:${monthKey(at)}`;

/**
 * Month-to-date cost of the workspace's own-key calls, in USD.
 *
 * A Redis failure is treated as a cache miss: the cap must keep working when
 * the cache does not.
 *
 * @param workspaceId - The workspace.
 * @param deps - Test seams.
 * @returns USD, `0` when nothing is priced yet.
 */
export async function monthToDateCostUsd(
  workspaceId: string,
  deps: SpendCapDeps = {},
): Promise<number> {
  const db = deps.db ?? prisma;
  const redis = deps.redis ?? pubClient;
  const now = (deps.now ?? (() => new Date()))();
  const key = spendCacheKey(workspaceId, now);

  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      const parsed = Number(cached);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch {
    // A cache read failure falls through to the database.
  }

  const aggregate = await db.aiCall.aggregate({
    where: {
      workspaceId,
      source: "BYOK",
      createdAt: { gte: monthStart(now) },
    },
    _sum: { costUsd: true },
  });
  const total = aggregate._sum.costUsd ? Number(aggregate._sum.costUsd) : 0;

  try {
    await redis.set(key, String(total), "EX", SPEND_CACHE_TTL_SECONDS);
  } catch {
    // Not caching only costs the next caller a query.
  }
  return total;
}

/**
 * Whether the workspace has reached its monthly cap.
 *
 * @param workspaceId - The workspace.
 * @param deps - Test seams.
 * @returns `false` when no cap is set; otherwise whether month-to-date cost has
 *          reached it.
 */
export async function isOverCap(
  workspaceId: string,
  deps: SpendCapDeps = {},
): Promise<boolean> {
  const db = deps.db ?? prisma;
  const settings = await readWorkspaceAiSettings(workspaceId, db);
  if (settings.monthlySpendCapUsd === null) return false;
  const spent = await monthToDateCostUsd(workspaceId, deps);
  return spent >= settings.monthlySpendCapUsd;
}
