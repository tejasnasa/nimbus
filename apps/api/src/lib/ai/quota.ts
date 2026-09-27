/**
 * @module api/lib/ai/quota
 * @description Free-tier document-generation quota.
 *
 * Decision 5 grants every user a fixed number of free *document* generations
 * (chat replies remain unlimited). The counter lives on `User` and is
 * incremented by a single conditional UPDATE, which is race-safe by
 * construction: Postgres takes the row lock, the loser waits, and the WHERE
 * is re-evaluated against the updated row after the lock is acquired.
 *
 * @important The claim is the only authoritative check; the cheap read in
 *            {@link readQuotaState} is a one-generation-stale estimate for
 *            the status endpoint. A concurrent request can land between the
 *            read and the claim, so the caller must handle the "claim
 *            refused because someone else just spent the last slot" case by
 *            treating `claimFreeDocGeneration` returning `granted: false` as
 *            a quota-exhausted refusal, never as a UI bug.
 */
import { prisma } from "@nimbus/db";

/** The user-facing shape the resolver and the status endpoint share. */
export type QuotaState = {
  /** Generations consumed so far. May be a moment stale under concurrency. */
  readonly used: number;
  /** Generations allowed in total. Read at call time so it can be tuned. */
  readonly limit: number;
  /** `limit - used`, clamped at zero. Convenience for the UI. */
  readonly remaining: number;
  /** Whether the limit has been reached, by the cheap read. */
  readonly exhausted: boolean;
};

/** Reads `AI_FREE_DOC_LIMIT` as a non-negative integer, defaulting to 5. */
export function readQuotaLimit(): number {
  const raw = process.env.AI_FREE_DOC_LIMIT;
  if (!raw) return 5;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 5;
  return parsed;
}

/**
 * Reads the user's current quota usage.
 *
 * The read is intentionally cheap — no transaction, no lock — so the status
 * endpoint can call it on every render without contending with concurrent
 * generations. Under load the value can be a few seconds stale; the
 * authoritative answer lives in {@link claimFreeDocGeneration}.
 *
 * @param userId - The user whose quota is being inspected.
 * @returns The current state, with `remaining` clamped at zero.
 */
export async function readQuotaState(userId: string): Promise<QuotaState> {
  const limit = readQuotaLimit();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { freeDocGenerationsUsed: true },
  });
  const used = user?.freeDocGenerationsUsed ?? 0;
  const remaining = Math.max(0, limit - used);

  return {
    used,
    limit,
    remaining,
    exhausted: remaining === 0,
  };
}

/** Outcome of a single quota claim. */
export type QuotaClaim =
  | { granted: true; used: number; limit: number }
  | { granted: false; used: number; limit: number; reason: "free-tier-exhausted" };

/**
 * Atomically claims one free document generation slot.
 *
 * Implementation: a single `updateMany` with `WHERE freeDocGenerationsUsed <
 * limit`. Postgres takes the row lock on the user row, the loser waits, the
 * winner's increment commits, the loser's `WHERE` is re-evaluated and finds
 * no row to update — so `count === 0` is the authoritative "exhausted"
 * signal.
 *
 * @param userId - The user whose quota is being claimed.
 * @returns Whether the slot was granted, plus the observed counters so the
 *          caller can build a refusal message without a second read.
 */
export async function claimFreeDocGeneration(userId: string): Promise<QuotaClaim> {
  const limit = readQuotaLimit();
  const result = await prisma.user.updateMany({
    where: {
      id: userId,
      freeDocGenerationsUsed: { lt: limit },
    },
    data: {
      freeDocGenerationsUsed: { increment: 1 },
    },
  });

  if (result.count === 1) {
    // We know the row existed and the increment succeeded, so the new value
    // is exactly one more than the previous. A re-read is unnecessary and
    // would just race.
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { freeDocGenerationsUsed: true },
    });
    return {
      granted: true,
      used: current?.freeDocGenerationsUsed ?? 1,
      limit,
    };
  }

  // count === 0: either the user does not exist or the quota is exhausted.
  // The two are not distinguished here — the caller treats both as a refusal
  // and the caller also has `socket.data.user` populated, so a missing user
  // is a 401 that has already happened upstream.
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { freeDocGenerationsUsed: true },
  });
  const used = current?.freeDocGenerationsUsed ?? limit;
  return { granted: false, used, limit, reason: "free-tier-exhausted" };
}

/**
 * Refunds a previously-claimed slot. The mirror image of
 * {@link claimFreeDocGeneration}: same atomic UPDATE shape, but `decrement`
 * guarded by `{ gt: 0 }` so the counter can never go negative.
 *
 * Refunds are bounded — a refund only returns what *this* call spent, gated
 * on a "did this call claim?" boolean in the detached scope, and the only
 * failure path that triggers one is provider-side. So this exists to keep a
 * provider failure from burning one of the user's free generations, and is
 * not a general-purpose counter.
 *
 * @param userId - The user whose quota is being refunded.
 * @returns Whether the refund was applied. False when the counter was
 *          already at zero (a no-op rather than an error).
 */
export async function refundFreeDocGeneration(userId: string): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: {
      id: userId,
      freeDocGenerationsUsed: { gt: 0 },
    },
    data: {
      freeDocGenerationsUsed: { decrement: 1 },
    },
  });
  return result.count === 1;
}
