/**
 * @module agent/__tests__/hallucinationFilter
 * @description What the filter throws away and, as importantly, what it keeps.
 */
import { describe, expect, it } from "vitest";
import { rmsEnergy } from "../audio/energy.js";
import { QUIET_RMS, isHallucination } from "../stt/hallucinationFilter.js";

const QUIET = QUIET_RMS / 4;
const LOUD = 0.1;

describe("isHallucination", () => {
  it("drops empty and whitespace-only results at any level", () => {
    expect(isHallucination("", LOUD)).toBe(true);
    expect(isHallucination("   \n", LOUD)).toBe(true);
    expect(isHallucination("...", LOUD)).toBe(true);
  });

  it.each([
    "Thank you for watching.",
    "thanks for watching!",
    "you",
    "Hey",
    "Subtitles by the Amara.org community",
    "Please subscribe.",
  ])("drops the stock phrase %j over a quiet clip", (phrase) => {
    expect(isHallucination(phrase, QUIET)).toBe(true);
  });

  it("keeps the same phrase when it was said at a normal level", () => {
    expect(isHallucination("Thank you for watching.", LOUD)).toBe(false);
    expect(isHallucination("Hey", LOUD)).toBe(false);
  });

  it("keeps a real sentence over a quiet clip", () => {
    expect(isHallucination("Can you share the roadmap draft", QUIET)).toBe(false);
  });

  it("drops one token repeated, however loud", () => {
    expect(isHallucination("the the the the the", LOUD)).toBe(true);
    expect(isHallucination("No no no no.", LOUD)).toBe(true);
  });

  it("keeps a short repeat that people really say", () => {
    expect(isHallucination("no no no", LOUD)).toBe(false);
  });

  it("ignores case and punctuation when matching phrases", () => {
    expect(isHallucination("  THANK   YOU, for watching!!! ", QUIET)).toBe(true);
  });
});

describe("rmsEnergy", () => {
  it("is zero for silence and an empty clip", () => {
    expect(rmsEnergy(new Int16Array(100))).toBe(0);
    expect(rmsEnergy(new Int16Array(0))).toBe(0);
  });

  it("is one for a full-scale square wave", () => {
    const square = new Int16Array(100).fill(-32768);

    expect(rmsEnergy(square)).toBeCloseTo(1, 5);
  });

  it("separates quiet from loud", () => {
    const quiet = new Int16Array(100).fill(100);
    const loud = new Int16Array(100).fill(10_000);

    expect(rmsEnergy(quiet)).toBeLessThan(QUIET_RMS);
    expect(rmsEnergy(loud)).toBeGreaterThan(QUIET_RMS);
  });
});
