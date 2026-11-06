/**
 * @module api/__tests__/integration/persistence/spendCap
 * @description The monthly spend cap against the real database: the UTC month
 * boundary, BYOK-only accounting, the 30 second cache, and the "no cap" case.
 */
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  closeTestResources,
  createUser,
  createWorkspace,
  resetDatabase,
  testPrisma,
} from "@testhelpers";
import {
  SPEND_CACHE_TTL_SECONDS,
  isOverCap,
  monthKey,
  monthStart,
  monthToDateCostUsd,
  spendCacheKey,
} from "../../../lib/ai/spendCap";

/** An in-memory stand-in for the two Redis calls the cap uses. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK" as const;
    }),
  };
}

let workspaceId: string;
let userId: string;

async function addCall(
  costUsd: number | null,
  createdAt: Date,
  source: "BYOK" | "FREE" = "BYOK",
) {
  await testPrisma.aiCall.create({
    data: {
      workspaceId,
      userId,
      feature: "CHAT",
      providerId: "openai",
      modelId: "gpt-5-nano",
      source,
      status: "OK",
      latencyMs: 5,
      costUsd,
      createdAt,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  const owner = await createUser();
  userId = owner.id;
  workspaceId = (await createWorkspace(owner.id)).id;
});

afterAll(async () => {
  await closeTestResources();
});

describe("month helpers", () => {
  it("keys and starts the month in UTC", () => {
    const at = new Date("2026-03-31T23:30:00Z");
    expect(monthKey(at)).toBe("2026-03");
    expect(monthStart(at).toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(spendCacheKey("ws", at)).toBe("spend:ws:2026-03");
  });
});

describe("monthToDateCostUsd", () => {
  it("sums BYOK cost for the current UTC month only", async () => {
    const now = new Date("2026-05-15T12:00:00Z");
    await addCall(1.25, new Date("2026-05-02T00:00:00Z"));
    await addCall(0.75, new Date("2026-05-01T00:00:00Z")); // first instant counts
    await addCall(9, new Date("2026-04-30T23:59:59.999Z")); // last month
    await addCall(5, new Date("2026-05-10T00:00:00Z"), "FREE"); // not the workspace's money
    await addCall(null, new Date("2026-05-11T00:00:00Z")); // unpriced adds nothing

    const total = await monthToDateCostUsd(workspaceId, {
      redis: fakeRedis(),
      now: () => now,
    });
    expect(total).toBeCloseTo(2, 6);
  });

  it("is zero for a workspace with no calls", async () => {
    await expect(
      monthToDateCostUsd(workspaceId, { redis: fakeRedis() }),
    ).resolves.toBe(0);
  });

  it("caches the sum for thirty seconds", async () => {
    const redis = fakeRedis();
    const now = new Date("2026-05-15T12:00:00Z");
    await addCall(1, new Date("2026-05-02T00:00:00Z"));

    await monthToDateCostUsd(workspaceId, { redis, now: () => now });
    expect(redis.set).toHaveBeenCalledWith(
      spendCacheKey(workspaceId, now),
      "1",
      "EX",
      SPEND_CACHE_TTL_SECONDS,
    );

    // A new call inside the window is not seen: the cached value answers.
    await addCall(4, new Date("2026-05-03T00:00:00Z"));
    await expect(
      monthToDateCostUsd(workspaceId, { redis, now: () => now }),
    ).resolves.toBe(1);

    // Once the entry is gone the next read recomputes.
    redis.store.clear();
    await expect(
      monthToDateCostUsd(workspaceId, { redis, now: () => now }),
    ).resolves.toBe(5);
  });

  it("keeps a separate cache entry per month", async () => {
    const redis = fakeRedis();
    await addCall(2, new Date("2026-05-02T00:00:00Z"));
    await monthToDateCostUsd(workspaceId, {
      redis,
      now: () => new Date("2026-05-20T00:00:00Z"),
    });
    // June starts at zero even though May's entry is still cached.
    await expect(
      monthToDateCostUsd(workspaceId, {
        redis,
        now: () => new Date("2026-06-01T00:00:00Z"),
      }),
    ).resolves.toBe(0);
  });

  it("treats a Redis failure as a cache miss", async () => {
    await addCall(3, new Date("2026-05-02T00:00:00Z"));
    const broken = {
      get: vi.fn(async () => {
        throw new Error("redis down");
      }),
      set: vi.fn(async () => {
        throw new Error("redis down");
      }),
    };
    await expect(
      monthToDateCostUsd(workspaceId, {
        redis: broken as never,
        now: () => new Date("2026-05-15T00:00:00Z"),
      }),
    ).resolves.toBe(3);
  });

  it("ignores a corrupt cache entry", async () => {
    const redis = fakeRedis();
    const now = new Date("2026-05-15T12:00:00Z");
    redis.store.set(spendCacheKey(workspaceId, now), "not-a-number");
    await addCall(2, new Date("2026-05-02T00:00:00Z"));
    await expect(
      monthToDateCostUsd(workspaceId, { redis, now: () => now }),
    ).resolves.toBe(2);
  });
});

describe("isOverCap", () => {
  const now = new Date("2026-05-15T12:00:00Z");

  it("is false when no cap is set, however much was spent", async () => {
    await addCall(1000, new Date("2026-05-02T00:00:00Z"));
    await expect(
      isOverCap(workspaceId, { redis: fakeRedis(), now: () => now }),
    ).resolves.toBe(false);
  });

  it("is true once spend reaches the cap, and false below it", async () => {
    await testPrisma.workspaceAiSettings.create({
      data: { workspaceId, monthlySpendCapUsd: 2 },
    });
    await addCall(1.5, new Date("2026-05-02T00:00:00Z"));
    await expect(
      isOverCap(workspaceId, { redis: fakeRedis(), now: () => now }),
    ).resolves.toBe(false);

    await addCall(0.5, new Date("2026-05-03T00:00:00Z"));
    await expect(
      isOverCap(workspaceId, { redis: fakeRedis(), now: () => now }),
    ).resolves.toBe(true);
  });

  it("resets at the start of the next UTC month", async () => {
    await testPrisma.workspaceAiSettings.create({
      data: { workspaceId, monthlySpendCapUsd: 1 },
    });
    await addCall(5, new Date("2026-05-31T23:59:59Z"));
    const redis = fakeRedis();
    await expect(
      isOverCap(workspaceId, {
        redis,
        now: () => new Date("2026-05-31T23:59:59Z"),
      }),
    ).resolves.toBe(true);
    await expect(
      isOverCap(workspaceId, {
        redis,
        now: () => new Date("2026-06-01T00:00:00Z"),
      }),
    ).resolves.toBe(false);
  });
});
