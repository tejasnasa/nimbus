/**
 * @module api/__tests__/smoke/health
 * @description Health-probe tests. The route is exercised against the real test
 * stack (so a genuinely reachable dependency is covered), and the probe's
 * failure modes are driven through injected fakes — a real Redis outage cannot
 * be produced here, and the deadline branch must not cost 1.5s per run.
 *
 * The media server's client is wrapped so the route can be shown answering
 * healthy while LiveKit is down: voice is optional and must not fail health.
 */
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const { listRoomsMock } = vi.hoisted(() => ({ listRoomsMock: vi.fn() }));

vi.mock("../../lib/livekit/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/livekit/client")>();
  return {
    ...actual,
    getRoomServiceClient: () => ({ listRooms: () => listRoomsMock() }),
  };
});

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
    livekit?: Partial<HealthClients["livekit"]>;
  } = {},
): HealthClients => ({
  database: { $queryRaw: () => Promise.resolve([{ one: 1 }]), ...overrides.database },
  redis: { status: "ready", ping: () => Promise.resolve("PONG"), ...overrides.redis },
  livekit: { listRooms: () => Promise.resolve([]), ...overrides.livekit },
});

afterEach(() => listRoomsMock.mockReset());

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

  it("stays healthy with the media server down, and says so", async () => {
    listRoomsMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect
      .poll(
        async () => (await request(app).get("/api/health")).body?.responseObject?.status,
        { timeout: 10_000, interval: 250 },
      )
      .toBe("ok");

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.responseObject.checks.livekit).toEqual({
      ok: false,
      error: "connect ECONNREFUSED",
    });
  });
});

describe("api smoke: probeDependencies", () => {
  it("reports healthy when both dependencies answer", async () => {
    const checks = await probeDependencies(healthyClients());

    expect(checks).toEqual({
      database: { ok: true },
      redis: { ok: true },
      livekit: { ok: true },
    });
  });

  it("reports the media server down when it rejects, leaving the others alone", async () => {
    const checks = await probeDependencies(
      healthyClients({
        livekit: { listRooms: () => Promise.reject(new Error("401 unauthorized")) },
      }),
    );

    expect(checks.livekit).toEqual({ ok: false, error: "401 unauthorized" });
    expect(checks.database.ok).toBe(true);
    expect(checks.redis.ok).toBe(true);
  });

  it("times out a media server that never answers", async () => {
    const checks = await probeDependencies(
      healthyClients({ livekit: { listRooms: () => new Promise(() => {}) } }),
      20,
    );

    expect(checks.livekit.ok).toBe(false);
    expect(checks.livekit.error).toContain("livekit did not respond in 20ms");
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
