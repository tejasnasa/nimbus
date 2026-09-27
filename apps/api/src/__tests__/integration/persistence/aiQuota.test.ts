/**
 * @module api/__tests__/integration/persistence/aiQuota
 * @description Race-safety contract for the free-tier quota claim.
 *
 * The quota lives on `User.freeDocGenerationsUsed` and is incremented by a
 * single conditional UPDATE — that is the headline design choice. The test
 * that proves it works under load is the one the plan calls out by name:
 *
 *   > `Promise.all` of 10 concurrent claims with limit 5 → exactly 5 granted
 *
 * Without a row lock, ten concurrent claims on a user at counter=0 would
 * each read 0 < 5, each increment to 1, and the counter would land at 1
 * while ten callers think they got their slot. With the row lock and the
 * re-evaluated WHERE, exactly five succeed and the counter lands at 5.
 *
 * The refund test is the second contract: a refund restores exactly one
 * slot, and a refund on a zero counter is a no-op (never goes negative).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  closeTestResources,
  createUser,
  resetDatabase,
  testPrisma,
} from "@testhelpers";
import {
  claimFreeDocGeneration,
  readQuotaState,
  refundFreeDocGeneration,
} from "../../../lib/ai/quota";

const LIMIT_ENV = "AI_FREE_DOC_LIMIT";
const ORIGINAL_LIMIT = process.env[LIMIT_ENV];

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  // Pin the limit so every case in this file runs against the same number
  // — 5 is the plan default and the headline race-test value.
  process.env[LIMIT_ENV] = "5";
});

afterAll(async () => {
  if (ORIGINAL_LIMIT === undefined) delete process.env[LIMIT_ENV];
  else process.env[LIMIT_ENV] = ORIGINAL_LIMIT;
  await closeTestResources();
});

/** Reads the current counter directly, bypassing the helper's read path so
 *  tests can assert on the exact final value rather than a "remaining". */
const readUsed = async (userId: string) => {
  const user = await testPrisma.user.findUnique({
    where: { id: userId },
    select: { freeDocGenerationsUsed: true },
  });
  return user?.freeDocGenerationsUsed ?? 0;
};

describe("claimFreeDocGeneration — race-safe single UPDATE", () => {
  it("grants exactly 5 of 10 concurrent claims with limit 5", async () => {
    // The headline assertion. If the conditional UPDATE were a read-then-
    // write, ten concurrent claims on a fresh user (counter=0) would each
    // succeed and the counter would land at 1 (or worse, ten). The row lock
    // serialises the increments and the WHERE re-evaluates against the
    // post-increment row, so the loser sees `5 < 5` and gets count=0.
    const user = await createUser("Race User");

    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimFreeDocGeneration(user.id)),
    );

    const granted = results.filter((r) => r.granted).length;
    const refused = results.filter((r) => !r.granted).length;

    expect(granted).toBe(5);
    expect(refused).toBe(5);
    // Every refused claim names the same reason — the user knows why.
    for (const r of results) {
      if (!r.granted) expect(r.reason).toBe("free-tier-exhausted");
    }
    // The counter lands at exactly 5, never above and never below.
    expect(await readUsed(user.id)).toBe(5);
  });

  it("a second user with their own quota is unaffected by the first", async () => {
    // The conditional UPDATE keys off `id: userId`, so two users claiming
    // in parallel do not interfere. A naïve implementation that read a
    // global counter would.
    const a = await createUser("User A");
    const b = await createUser("User B");

    const [resultsA, resultsB] = await Promise.all([
      Promise.all(
        Array.from({ length: 6 }, () => claimFreeDocGeneration(a.id)),
      ),
      Promise.all(
        Array.from({ length: 6 }, () => claimFreeDocGeneration(b.id)),
      ),
    ]);

    expect(resultsA.filter((r) => r.granted).length).toBe(5);
    expect(resultsB.filter((r) => r.granted).length).toBe(5);
    expect(await readUsed(a.id)).toBe(5);
    expect(await readUsed(b.id)).toBe(5);
  });

  it("refuses a single claim after the limit is reached", async () => {
    // Single-threaded sanity: the conditional UPDATE alone, no concurrency.
    // Without it, every claim here would succeed and the counter would
    // climb past 5.
    const user = await createUser("Sequential User");

    for (let i = 0; i < 5; i += 1) {
      const claim = await claimFreeDocGeneration(user.id);
      expect(claim.granted).toBe(true);
    }

    const sixth = await claimFreeDocGeneration(user.id);
    expect(sixth.granted).toBe(false);
    if (!sixth.granted) expect(sixth.reason).toBe("free-tier-exhausted");
    expect(sixth.used).toBe(5);
    expect(sixth.limit).toBe(5);
    expect(await readUsed(user.id)).toBe(5);
  });
});

describe("refundFreeDocGeneration — the mirror image", () => {
  it("restores exactly one slot, and the next claim then succeeds", async () => {
    // A user who burned all 5 slots then hits a provider failure deserves
    // their last slot back. The refund must not grant +1 from the void —
    // it must undo exactly one claim.
    const user = await createUser("Refund User");
    for (let i = 0; i < 5; i += 1) {
      const claim = await claimFreeDocGeneration(user.id);
      expect(claim.granted).toBe(true);
    }
    expect(
      (await claimFreeDocGeneration(user.id)).granted,
    ).toBe(false);

    const refunded = await refundFreeDocGeneration(user.id);
    expect(refunded).toBe(true);
    expect(await readUsed(user.id)).toBe(4);

    const next = await claimFreeDocGeneration(user.id);
    expect(next.granted).toBe(true);
    expect(await readUsed(user.id)).toBe(5);
  });

  it("cannot drive the counter below zero", async () => {
    // The mirror defence to the WHERE on the claim: refunds only ever
    // decrement when `gt: 0`. A bug here would show up as a negative
    // counter, which would silently re-open the door to free generations
    // the user has already exhausted.
    const user = await createUser("Negative User");

    // Multiple refunds on a fresh user — only the first should land.
    expect(await refundFreeDocGeneration(user.id)).toBe(false);
    expect(await refundFreeDocGeneration(user.id)).toBe(false);
    expect(await readUsed(user.id)).toBe(0);

    // And one claim still works.
    expect((await claimFreeDocGeneration(user.id)).granted).toBe(true);
  });
});

describe("readQuotaState — the cheap read used by the status endpoint", () => {
  it("reports used, limit, remaining, and exhausted", async () => {
    // The status endpoint shows the user how many generations are left.
    // The read here is intentionally cheap; under concurrency it can be
    // stale by one claim, so the assertion is structural rather than
    // racing with anything else.
    const user = await createUser("Status User");
    await testPrisma.user.update({
      where: { id: user.id },
      data: { freeDocGenerationsUsed: 2 },
    });

    const state = await readQuotaState(user.id);

    expect(state.used).toBe(2);
    expect(state.limit).toBe(5);
    expect(state.remaining).toBe(3);
    expect(state.exhausted).toBe(false);
  });

  it("reports `exhausted: true` once the counter reaches the limit", async () => {
    const user = await createUser("Spent User");
    await testPrisma.user.update({
      where: { id: user.id },
      data: { freeDocGenerationsUsed: 5 },
    });

    const state = await readQuotaState(user.id);

    expect(state.used).toBe(5);
    expect(state.remaining).toBe(0);
    expect(state.exhausted).toBe(true);
  });

  it("clamps remaining at zero — used > limit does not yield a negative remaining", async () => {
    // The freeDocGenerationsUsed column has no upper-bound constraint at the
    // schema level (a manual SQL UPDATE could push it past the limit). The
    // UI must never render a negative remaining count, so the clamp matters.
    const user = await createUser("Over User");
    await testPrisma.user.update({
      where: { id: user.id },
      data: { freeDocGenerationsUsed: 7 },
    });

    const state = await readQuotaState(user.id);

    expect(state.used).toBe(7);
    expect(state.limit).toBe(5);
    expect(state.remaining).toBe(0);
    expect(state.exhausted).toBe(true);
  });

  it("returns `used: 0` for a missing user rather than throwing", async () => {
    // A user whose row was deleted between status calls would otherwise
    // crash the read; the resolver treats this case as "no quota info".
    const state = await readQuotaState("ghost-user-id");
    expect(state.used).toBe(0);
    expect(state.remaining).toBe(5);
    expect(state.exhausted).toBe(false);
  });
});
