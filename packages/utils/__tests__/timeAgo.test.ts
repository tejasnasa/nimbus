import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeAgo } from "../src/timeAgo";

/**
 * The clock is frozen so every boundary can be asserted exactly: `timeAgo`
 * reads `new Date()` internally, so without fake timers each case would be
 * racing the real clock by a few milliseconds.
 */
const NOW = new Date("2026-04-01T12:00:00.000Z");

/** Builds a timestamp `seconds` seconds away from the frozen "now". */
const offset = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("timeAgo — missing and invalid input", () => {
  it("returns 'Never' for undefined", () => {
    expect(timeAgo(undefined)).toBe("Never");
  });

  it("returns 'Never' for an empty string", () => {
    expect(timeAgo("")).toBe("Never");
  });

  it("throws for an unparseable string", () => {
    expect(() => timeAgo("not-a-date")).toThrow("Invalid date input");
  });

  it("throws for an Invalid Date object", () => {
    expect(() => timeAgo(new Date("nonsense"))).toThrow("Invalid date input");
  });

  it("accepts an ISO string as well as a Date object", () => {
    expect(timeAgo(offset(-3600))).toBe("1 hour ago");
    expect(timeAgo(offset(-3600).toISOString())).toBe("1 hour ago");
  });
});

describe("timeAgo — past timestamps", () => {
  it("returns 'just now' for the current instant", () => {
    expect(timeAgo(offset(0))).toBe("just now");
  });

  it("returns 'just now' up to and including 4 seconds", () => {
    expect(timeAgo(offset(-1))).toBe("just now");
    expect(timeAgo(offset(-4))).toBe("just now");
  });

  it("switches to seconds at exactly 5 seconds", () => {
    expect(timeAgo(offset(-5))).toBe("5 seconds ago");
    expect(timeAgo(offset(-6))).toBe("6 seconds ago");
  });

  it("stays in seconds up to 59 seconds", () => {
    expect(timeAgo(offset(-59.5))).toBe("59 seconds ago");
  });

  it("switches to minutes at exactly 60 seconds", () => {
    expect(timeAgo(offset(-60))).toBe("1 minute ago");
    expect(timeAgo(offset(-61))).toBe("1 minute ago");
    expect(timeAgo(offset(-119))).toBe("1 minute ago");
  });

  it("counts plural minutes", () => {
    expect(timeAgo(offset(-120))).toBe("2 minutes ago");
    expect(timeAgo(offset(-3599))).toBe("59 minutes ago");
  });

  it("switches to hours at exactly 3600 seconds", () => {
    expect(timeAgo(offset(-3600))).toBe("1 hour ago");
    expect(timeAgo(offset(-3601))).toBe("1 hour ago");
    expect(timeAgo(offset(-7200))).toBe("2 hours ago");
    expect(timeAgo(offset(-86399))).toBe("23 hours ago");
  });

  it("switches to days at exactly 86400 seconds", () => {
    expect(timeAgo(offset(-86400))).toBe("1 day ago");
    expect(timeAgo(offset(-86401))).toBe("1 day ago");
    expect(timeAgo(offset(-172800))).toBe("2 days ago");
  });

  it("switches to weeks at exactly 7 days", () => {
    expect(timeAgo(offset(-604799))).toBe("6 days ago");
    expect(timeAgo(offset(-604800))).toBe("1 week ago");
    expect(timeAgo(offset(-1209600))).toBe("2 weeks ago");
  });

  it("switches to months at exactly 30 days", () => {
    expect(timeAgo(offset(-2591999))).toBe("4 weeks ago");
    expect(timeAgo(offset(-2592000))).toBe("1 month ago");
    expect(timeAgo(offset(-5184000))).toBe("2 months ago");
  });

  it("switches to years at exactly 365 days and keeps counting months below that", () => {
    expect(timeAgo(offset(-31535999))).toBe("12 months ago");
    expect(timeAgo(offset(-31536000))).toBe("1 year ago");
    expect(timeAgo(offset(-31536001))).toBe("1 year ago");
    expect(timeAgo(offset(-63072000))).toBe("2 years ago");
  });
});

describe("timeAgo — future timestamps (clock skew)", () => {
  it("labels a future timestamp with the 'in …' form", () => {
    expect(timeAgo(offset(60))).toBe("in 1 minute");
    expect(timeAgo(offset(90))).toBe("in 1 minute");
    expect(timeAgo(offset(3600))).toBe("in 1 hour");
    expect(timeAgo(offset(86400))).toBe("in 1 day");
    expect(timeAgo(offset(31536000))).toBe("in 1 year");
  });

  it("pluralises future units", () => {
    expect(timeAgo(offset(2))).toBe("in 2 seconds");
    expect(timeAgo(offset(7200))).toBe("in 2 hours");
    expect(timeAgo(offset(172800))).toBe("in 2 days");
    expect(timeAgo(offset(63072000))).toBe("in 2 years");
  });

  it("rounds a sub-second future offset up to 'in 1 second'", () => {
    expect(timeAgo(offset(0.4))).toBe("in 1 second");
  });

  it("uses the same thresholds in both directions of skew", () => {
    expect(timeAgo(offset(-60))).toBe("1 minute ago");
    expect(timeAgo(offset(60))).toBe("in 1 minute");
    expect(timeAgo(offset(-604800))).toBe("1 week ago");
    expect(timeAgo(offset(604800))).toBe("in 1 week");
    expect(timeAgo(offset(-31536000))).toBe("1 year ago");
    expect(timeAgo(offset(31536000))).toBe("in 1 year");
  });

  it("does not apply the 5-second 'just now' grace window to future timestamps", () => {
    expect(timeAgo(offset(-4))).toBe("just now");
    expect(timeAgo(offset(4))).toBe("in 4 seconds");
  });
});
