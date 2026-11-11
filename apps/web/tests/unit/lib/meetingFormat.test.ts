/**
 * @module web/tests/unit/lib/meetingFormat
 * @description The Meetings tab's formatting helpers: durations, titles and
 * status labels, the transcript clock, a stable speaker colour, and splitting a
 * search snippet into text and highlight runs without ever yielding markup.
 */
import { describe, expect, it } from "vitest";
import {
  clock,
  describeDuration,
  meetingTitle,
  speakerColor,
  splitSnippet,
  statusLabel,
  statusTone,
} from "../../../lib/meetingFormat";

describe("describeDuration", () => {
  const started = "2026-11-01T09:00:00.000Z";

  it("reads live, under a minute, minutes and hours", () => {
    expect(describeDuration({ startedAt: started, endedAt: null })).toBe(
      "Live now",
    );
    expect(
      describeDuration({
        startedAt: started,
        endedAt: "2026-11-01T09:00:20.000Z",
      }),
    ).toBe("Under a minute");
    expect(
      describeDuration({
        startedAt: started,
        endedAt: "2026-11-01T09:12:00.000Z",
      }),
    ).toBe("12 min");
    expect(
      describeDuration({
        startedAt: started,
        endedAt: "2026-11-01T10:05:00.000Z",
      }),
    ).toBe("1 h 5 min");
  });
});

describe("clock", () => {
  it("formats milliseconds as m:ss and never goes negative", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65_000)).toBe("1:05");
    expect(clock(3_725_000)).toBe("62:05");
    expect(clock(-5)).toBe("0:00");
  });
});

describe("meetingTitle", () => {
  it("uses the title, or a dated fallback", () => {
    expect(
      meetingTitle({ title: "Launch", startedAt: "2026-11-01T09:00:00Z" }),
    ).toBe("Launch");
    expect(
      meetingTitle({ title: null, startedAt: "2026-11-01T09:00:00Z" }),
    ).toMatch(/^Untitled meeting, /);
  });
});

describe("status", () => {
  it("labels and tones every status", () => {
    expect(statusLabel("LIVE")).toBe("Live");
    expect(statusLabel("ENDED")).toBe("Writing notes…");
    expect(statusLabel("SUMMARIZED")).toBe("Notes ready");
    expect(statusLabel("FAILED")).toBe("Notes failed");
    const tones = (["LIVE", "ENDED", "SUMMARIZED", "FAILED"] as const).map(
      statusTone,
    );
    expect(new Set(tones).size).toBe(4);
  });
});

describe("speakerColor", () => {
  it("is stable per name and differs between names", () => {
    expect(speakerColor("Ada")).toBe(speakerColor("Ada"));
    expect(speakerColor("Ada")).not.toBe(speakerColor("Grace"));
    expect(speakerColor("")).toMatch(/^hsl\(/);
  });
});

describe("splitSnippet", () => {
  it("splits on mark tags only", () => {
    expect(splitSnippet("a <mark>b</mark> c <mark>d</mark>")).toEqual([
      { text: "a ", marked: false },
      { text: "b", marked: true },
      { text: " c ", marked: false },
      { text: "d", marked: true },
    ]);
  });

  it("returns other markup as plain text", () => {
    expect(splitSnippet("<b>x</b> <mark>y</mark> <script>")).toEqual([
      { text: "<b>x</b> ", marked: false },
      { text: "y", marked: true },
      { text: " <script>", marked: false },
    ]);
  });

  it("handles no marks, empty text and a stray closing tag", () => {
    expect(splitSnippet("plain")).toEqual([{ text: "plain", marked: false }]);
    expect(splitSnippet("")).toEqual([]);
    expect(splitSnippet("a</mark>b")).toEqual([
      { text: "a", marked: false },
      { text: "b", marked: false },
    ]);
  });
});
