/**
 * @module api/__tests__/unit/clock
 * @description The clock every time-aware path of NimbusBot reads: override,
 * then `AGENT_NOW`, then the real clock; and the rule that in production none
 * of the overrides is honoured.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { now, parseOverride, runWithClockOverride } from "../../lib/time/clock";

afterEach(() => {
  vi.unstubAllEnvs();
});

const nearNow = (date: Date) => Math.abs(date.getTime() - Date.now()) < 2000;

describe("parseOverride", () => {
  it("reads a bare date as noon UTC", () => {
    expect(parseOverride("2026-11-10")?.toISOString()).toBe(
      "2026-11-10T12:00:00.000Z",
    );
  });

  it("reads a full timestamp as given", () => {
    expect(parseOverride("2026-11-10T08:35:00+05:30")?.toISOString()).toBe(
      "2026-11-10T03:05:00.000Z",
    );
  });

  it("ignores empty, blank and unparseable values", () => {
    expect(parseOverride(undefined)).toBeNull();
    expect(parseOverride(null)).toBeNull();
    expect(parseOverride("   ")).toBeNull();
    expect(parseOverride("tomorrow-ish")).toBeNull();
    expect(parseOverride("2026-13-45")).toBeNull();
  });
});

describe("now()", () => {
  it("uses the real clock by default", () => {
    expect(nearNow(now())).toBe(true);
  });

  it("prefers the request override over AGENT_NOW", () => {
    vi.stubEnv("AGENT_NOW", "2026-01-01");
    expect(runWithClockOverride("2026-11-03", () => now().toISOString())).toBe(
      "2026-11-03T12:00:00.000Z",
    );
  });

  it("falls back to AGENT_NOW, then to the real clock", () => {
    vi.stubEnv("AGENT_NOW", "2026-02-02T08:00:00Z");
    expect(now().toISOString()).toBe("2026-02-02T08:00:00.000Z");
    expect(runWithClockOverride("garbage", () => now().toISOString())).toBe(
      "2026-02-02T08:00:00.000Z",
    );
    vi.stubEnv("AGENT_NOW", "not a date");
    expect(nearNow(now())).toBe(true);
  });

  it("keeps the override across awaits and does not leak out of the run", async () => {
    const seen = await runWithClockOverride("2026-11-03", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return now().toISOString();
    });
    expect(seen).toBe("2026-11-03T12:00:00.000Z");
    expect(nearNow(now())).toBe(true);
  });

  it("is always the real clock in production, whatever is sent or configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_NOW", "2026-02-02T08:00:00Z");
    expect(nearNow(now())).toBe(true);
    expect(nearNow(runWithClockOverride("2026-11-03", () => now()))).toBe(true);
  });

  it("honours overrides in test and development", () => {
    for (const mode of ["test", "development"]) {
      vi.stubEnv("NODE_ENV", mode);
      expect(
        runWithClockOverride("2026-11-03", () => now().toISOString()),
      ).toBe("2026-11-03T12:00:00.000Z");
    }
  });
});
