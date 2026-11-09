/**
 * @module agent/__tests__/clock
 * @description Meeting time: anchored to the meeting's start once, then driven
 * by the monotonic clock.
 */
import { describe, expect, it } from "vitest";
import { createMeetingClock } from "../session/clock.js";

describe("createMeetingClock", () => {
  it("starts at how long the meeting had already been running", () => {
    const clock = createMeetingClock("2026-01-01T00:00:00.000Z", {
      wall: () => Date.parse("2026-01-01T00:00:12.500Z"),
      mono: () => 5000,
    });

    expect(clock.elapsedMs()).toBe(12_500);
  });

  it("advances with the monotonic clock, not the wall clock", () => {
    let wall = Date.parse("2026-01-01T00:00:10.000Z");
    let mono = 100;
    const clock = createMeetingClock("2026-01-01T00:00:00.000Z", {
      wall: () => wall,
      mono: () => mono,
    });

    mono += 3000;
    wall -= 60_000; // the wall clock steps backwards mid-call

    expect(clock.elapsedMs()).toBe(13_000);
  });

  it("never starts negative when the API's clock is ahead of the agent's", () => {
    const clock = createMeetingClock("2026-01-01T00:00:05.000Z", {
      wall: () => Date.parse("2026-01-01T00:00:00.000Z"),
      mono: () => 0,
    });

    expect(clock.elapsedMs()).toBe(0);
  });

  it("works with the real clocks", () => {
    const clock = createMeetingClock(new Date(Date.now() - 1000).toISOString());

    expect(clock.elapsedMs()).toBeGreaterThanOrEqual(1000);
  });
});
