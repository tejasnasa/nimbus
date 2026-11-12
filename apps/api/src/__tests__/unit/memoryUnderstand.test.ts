/**
 * @module api/__tests__/unit/memoryUnderstand
 * @description Date and intent parsing for NimbusBot's memory: which day a
 * bare weekday or day-and-month means (always one that already happened),
 * "last week", day boundaries in the asker's timezone, and the difference
 * between a question about the workspace's own past and one about the world.
 * Pure: no database, no model.
 */
import { describe, expect, it } from "vitest";
import {
  applyPastBias,
  significantWords,
  understand,
} from "../../lib/memory/understand";

const TZ = "Asia/Kolkata";
/** Wednesday 2026-11-11, 14:05 in Kolkata. */
const NOW = new Date("2026-11-11T08:35:00Z");

const labels = (message: string, now = NOW, tz = TZ) =>
  understand(message, now, tz).ranges.map((range) => range.label);

describe("date resolution", () => {
  it("resolves a bare weekday to the most recent past one", () => {
    expect(labels("What did we decide on Tuesday?")).toEqual(["2026-11-10"]);
    expect(labels("On Monday we shortlisted 5 CRM tools")).toEqual([
      "2026-11-09",
    ]);
  });

  it("moves a weekday that chrono resolves forward back by a week", () => {
    expect(labels("what did I ask on Friday?")).toEqual(["2026-11-06"]);
  });

  it("resolves a day and month to this year when it already passed", () => {
    expect(labels("What did I ask you on 3 November?")).toEqual(["2026-11-03"]);
  });

  it("moves a day and month that would land in the future back a year", () => {
    const early = new Date("2026-10-20T09:00:00Z");
    expect(labels("What did I ask you on 3 November?", early)).toEqual([
      "2025-11-03",
    ]);
  });

  it("keeps an explicit year", () => {
    expect(labels("what did we decide on 3 November 2024")).toEqual([
      "2024-11-03",
    ]);
  });

  it("looks back across a year boundary for a weekday", () => {
    const tuesday = new Date("2027-01-05T08:00:00Z");
    expect(labels("what did we decide on Friday", tuesday)).toEqual([
      "2027-01-01",
    ]);
    expect(labels("what did we decide on Thursday", tuesday)).toEqual([
      "2026-12-31",
    ]);
  });

  it("looks back across a year boundary for a day and month", () => {
    const lateDecember = new Date("2026-12-28T08:00:00Z");
    expect(labels("what happened on 2 January", lateDecember)).toEqual([
      "2026-01-02",
    ]);
    const earlyJanuary = new Date("2027-01-05T08:00:00Z");
    expect(labels("what happened on 3 December", earlyJanuary)).toEqual([
      "2026-12-03",
    ]);
  });

  it("resolves yesterday and today where the day is certain", () => {
    expect(labels("what did I ask you yesterday")).toEqual(["2026-11-10"]);
    expect(labels("what did I ask you today")).toEqual(["2026-11-11"]);
  });

  it("ignores vague time words", () => {
    expect(labels("let us talk soon, maybe in the morning")).toEqual([]);
  });

  it("resolves last week to the previous Monday-to-Monday range", () => {
    const [range] = understand("what happened last week", NOW, TZ).ranges;
    expect(range).toMatchObject({
      label: "2026-11-02",
      kind: "week",
      startIso: "2026-11-01T18:30:00.000Z",
      endIso: "2026-11-08T18:30:00.000Z",
    });
  });

  it("builds day ranges in the user's timezone", () => {
    const [range] = understand("Monday", NOW, TZ).ranges;
    expect(range).toMatchObject({
      kind: "day",
      startIso: "2026-11-08T18:30:00.000Z",
      endIso: "2026-11-09T18:30:00.000Z",
    });
    const [utc] = understand("Monday", NOW, "UTC").ranges;
    expect(utc?.startIso).toBe("2026-11-09T00:00:00.000Z");
  });

  it("puts the same instant on different days in Kolkata and UTC", () => {
    // 20:00 UTC on Tuesday is already 01:30 on Wednesday in Kolkata.
    const lateTuesdayUtc = new Date("2026-11-10T20:00:00Z");
    expect(
      labels("what did I ask yesterday", lateTuesdayUtc, "Asia/Kolkata"),
    ).toEqual(["2026-11-10"]);
    expect(labels("what did I ask yesterday", lateTuesdayUtc, "UTC")).toEqual([
      "2026-11-09",
    ]);
    expect(
      labels("what did I ask today", lateTuesdayUtc, "Asia/Kolkata"),
    ).toEqual(["2026-11-11"]);
    expect(labels("what did I ask today", lateTuesdayUtc, "UTC")).toEqual([
      "2026-11-10",
    ]);
  });

  it("applyPastBias leaves past dates alone and moves future ones back", () => {
    const past = new Date("2026-11-09T00:00:00Z");
    expect(applyPastBias(past, NOW, "weekday")).toBe(past);
    const future = new Date("2026-11-13T00:00:00Z");
    expect(applyPastBias(future, NOW, "weekday").toISOString()).toBe(
      "2026-11-06T00:00:00.000Z",
    );
    expect(applyPastBias(future, NOW, "date").toISOString()).toBe(
      "2025-11-13T00:00:00.000Z",
    );
  });
});

describe("references to the workspace's past", () => {
  const past = (message: string) => understand(message, NOW, TZ).refersToPast;

  it.each([
    "what did I ask you on Monday",
    "you said Pipedrive was cheaper, is that still correct?",
    "you told us the launch was Friday",
    "What did we decide on Tuesday's call?",
    "did we agree on a budget?",
    "we discussed this in the meeting on 3 November",
    "Is that still the plan?",
    "any open action items from the standup?",
    "what happened last week?",
    "last time we talked about pricing",
  ])("is true for %s", (message) => {
    expect(past(message)).toBe(true);
  });

  it("is false for a past event in the world", () => {
    const u = understand("what did Apple ship on Monday", NOW, TZ);
    expect(u.ranges).toHaveLength(1);
    expect(u.refersToPast).toBe(false);
  });

  it("is false for a version comparison using since", () => {
    expect(past("Has Next.js caching changed since v15?")).toBe(false);
  });

  it("is false for a plain question or today alone", () => {
    expect(past("What is the capital of Australia?")).toBe(false);
    expect(past("what is the weather today")).toBe(false);
  });

  it("tells meeting questions from chat questions", () => {
    expect(
      understand("what did we decide on the call", NOW, TZ).refersToMeeting,
    ).toBe(true);
    expect(
      understand("what did I ask on Monday", NOW, TZ).refersToMeeting,
    ).toBe(false);
  });

  it("detects questions about change", () => {
    expect(understand("Is that still the plan?", NOW, TZ).asksAboutChange).toBe(
      true,
    );
    expect(
      understand("has anything changed since then", NOW, TZ).asksAboutChange,
    ).toBe(true);
    expect(understand("what did we decide", NOW, TZ).asksAboutChange).toBe(
      false,
    );
  });
});

describe("keywords", () => {
  it("drops stopwords, date words and bot words", () => {
    const u = understand(
      "@NimbusBot what did we decide on Tuesday's call about postgres hosting?",
      NOW,
      TZ,
    );
    expect(u.keywords).toEqual(["postgres", "hosting"]);
    expect(u.searchQuery).toBe("postgres or hosting");
  });

  it("returns a null query when nothing searchable remains", () => {
    const u = understand("What did I ask you on 3 November?", NOW, TZ);
    expect(u.searchQuery).toBeNull();
    expect(u.keywords).toEqual([]);
  });

  it("exposes significantWords for topic overlap", () => {
    expect(significantWords("Ship the beta on Friday")).toEqual([
      "ship",
      "beta",
    ]);
  });
});
