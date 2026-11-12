/**
 * @module web/tests/unit/lib/chatClock
 * @description The time fields a chat message carries: the viewer's timezone,
 * and a clock override that is read from storage and sent only outside
 * production.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chatTimeContext,
  CLOCK_OVERRIDE_STORAGE_KEY,
  getClockOverride,
  getViewerTimeZone,
} from "../../../lib/chatClock";

const stubStorage = (value: string | null) =>
  vi.stubGlobal("localStorage", { getItem: () => value });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("chatClock", () => {
  it("reads the viewer's IANA timezone", () => {
    expect(getViewerTimeZone()).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });

  it("reads the override from storage outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    stubStorage(" 2026-11-11 ");
    expect(CLOCK_OVERRIDE_STORAGE_KEY).toBe("nimbus:agent-now");
    expect(getClockOverride()).toBe("2026-11-11");
    expect(chatTimeContext().clockOverride).toBe("2026-11-11");
  });

  it("ignores the override in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    stubStorage("2026-11-11");
    expect(getClockOverride()).toBeUndefined();
    expect(chatTimeContext()).not.toHaveProperty("clockOverride");
    expect(chatTimeContext()).toHaveProperty("timeZone");
  });

  it("omits the override when nothing is stored or storage is unavailable", () => {
    vi.stubEnv("NODE_ENV", "development");
    stubStorage(null);
    expect(getClockOverride()).toBeUndefined();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(getClockOverride()).toBeUndefined();
  });
});
