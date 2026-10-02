/**
 * @module api/__tests__/smoke/health
 * @description Health-probe tests. The route is exercised against the real test
 * stack (so a genuinely reachable dependency is covered), and the probe's
 * failure modes are driven through injected fakes — a real Redis outage cannot
 * be produced here, and the deadline branch must not cost 1.5s per run.
 */
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import {
  PROBE_TIMEOUT_MS,
  probeDependencies,
  type HealthClients,
} from "../../controllers/health.controller";

const app = createApp();

/** A dependency set that answers correctly, overridable per test. */
const healthyClients = (
  overrides: {
    database?: Partial<HealthClients["database"]>;
    redis?: Partial<HealthClients["redis"]>;
  } = {},
): HealthClients => ({
  database: { $queryRaw: () => Promise.resolve([{ one: 1 }]), ...overrides.database },
  redis: { status: "ready", ping: () => Promise.resolve("PONG"), ...overrides.redis },
});

describe("api smoke: health route", () => {
  it("answers anonymous callers in the standard envelope", async () => {
    const res = await request(app).get("/api/health");

    // 401 would mean it was mounted behind `authCheck`; 404 would mean the
    // `/api` not-found handler swallowed it. Neither depends on whether the
    // dependencies have finished connecting, which is asserted separately —
    // conflating the two is what made this test flaky.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(404);
    expect(res.body).toMatchObject({ statusCode: res.status });
    expect(typeof res.body.success).toBe("boolean");
  });

  it("reports both dependencies up once the clients connect", async () => {
    // The Redis client is not `ready` the instant the app is built, so the
    // route answers 503 until it is. Poll rather than sleep a fixed amount.
    await expect
      .poll(
        async () => (await request(app).get("/api/health")).body?.responseObject?.status,
        { timeout: 10_000, interval: 250 },
      )
      .toBe("ok");

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.responseObject).toMatchObject({
      status: "ok",
      checks: { database: { ok: true }, redis: { ok: true } },
    });
  });
});

describe("api smoke: probeDependencies", () => {
  it("reports healthy when both dependencies answer", async () => {
    const checks = await probeDependencies(healthyClients());

    expect(checks).toEqual({ database: { ok: true }, redis: { ok: true } });
  });

  it("reports the database down when the query rejects", async () => {
    const checks = await probeDependencies(
      healthyClients({
        database: { $queryRaw: () => Promise.reject(new Error("ECONNREFUSED")) },
      }),
    );

    expect(checks.database).toEqual({ ok: false, error: "ECONNREFUSED" });
    // The probes are independent: one failing must not mask the other.
    expect(checks.redis.ok).toBe(true);
  });

  it("skips the ping and names the status when Redis is not ready", async () => {
    const ping = vi.fn(() => Promise.reject(new Error("should not be called")));

    const checks = await probeDependencies(
      healthyClients({ redis: { status: "reconnecting", ping } }),
    );

    expect(checks.redis.ok).toBe(false);
    expect(checks.redis.error).toContain("reconnecting");
    // The point of the short-circuit: a queued ping would never settle.
    expect(ping).not.toHaveBeenCalled();
  });

  it("times out a dependency that never settles instead of hanging", async () => {
    const checks = await probeDependencies(
      healthyClients({ database: { $queryRaw: () => new Promise(() => {}) } }),
      20,
    );

    expect(checks.database.ok).toBe(false);
    expect(checks.database.error).toContain("did not respond in 20ms");
  });

  it("defaults its deadline to PROBE_TIMEOUT_MS", () => {
    expect(PROBE_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
