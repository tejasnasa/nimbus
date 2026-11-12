/**
 * @module api/__tests__/unit/memoryRender
 * @description The text NimbusBot is given about the past, without a
 * database: the dated meeting rendering in its full and compact forms, the
 * per-turn context message, the token estimate, and the `message:send` time
 * fields' validation.
 */
import { describe, expect, it } from "vitest";
import { messageSendSchema, normalizeTimeZone } from "@nimbus/types";
import { buildContextMessage } from "../../lib/memory/context";
import {
  estimateTokens,
  renderMeeting,
  type RecalledMeeting,
} from "../../lib/memory/recall";

const TZ = "Asia/Kolkata";

const meeting = (over: Partial<RecalledMeeting> = {}): RecalledMeeting => ({
  id: "m1",
  startedAt: new Date("2026-11-10T08:30:00Z"),
  endedAt: new Date("2026-11-10T09:02:00Z"),
  status: "SUMMARIZED",
  title: "Beta launch planning",
  participants: ["Priya Shah", "Tom Brandt"],
  summary: "The team agreed to ship the beta on Friday.",
  openQuestions: ["Who reviews the rollback plan?"],
  decisions: ["Ship the beta on Friday"],
  actionItems: [
    {
      text: "Update the changelog",
      owner: "Tom",
      dueDate: new Date("2026-11-13T00:00:00Z"),
      status: "DONE",
      completedAt: new Date("2026-11-11T03:42:00Z"),
    },
    {
      text: "Write the rollback plan",
      owner: null,
      dueDate: null,
      status: "OPEN",
      completedAt: null,
    },
  ],
  notesDocument: { id: "doc1", title: "Meeting notes [draft]" },
  excerpt: [],
  score: 0,
  ...over,
});

describe("renderMeeting", () => {
  it("renders the full form in the asker's timezone", () => {
    expect(renderMeeting(meeting(), TZ, false)).toBe(
      [
        '[Tue 2026-11-10 14:00] Meeting "Beta launch planning" (32 min, Priya Shah, Tom Brandt)',
        "  Notes document: [Meeting notes draft](nimbus-doc:doc1)",
        "  Summary: The team agreed to ship the beta on Friday.",
        "  Decisions:",
        "  - Ship the beta on Friday",
        "  Open questions:",
        "  - Who reviews the rollback plan?",
        "  Action items (current status):",
        "  - Update the changelog | owner Tom | due 2026-11-13 | DONE (completed Wed 2026-11-11 09:12)",
        "  - Write the rollback plan | owner unassigned | OPEN",
      ].join("\n"),
    );
  });

  it("drops open questions and shortens the summary in the compact form", () => {
    const long = "word ".repeat(200);
    const compact = renderMeeting(meeting({ summary: long }), TZ, true);
    expect(compact).not.toContain("Open questions:");
    expect(compact).toContain("- Ship the beta on Friday");
    expect(compact).toContain("DONE (completed");
    expect(compact.length).toBeLessThan(
      renderMeeting(meeting({ summary: long }), TZ, false).length,
    );
    expect(compact).toContain("...");
  });

  it("shows status and a transcript excerpt when there are no notes", () => {
    const text = renderMeeting(
      meeting({
        status: "ENDED",
        title: null,
        summary: null,
        decisions: [],
        actionItems: [],
        openQuestions: [],
        notesDocument: null,
        excerpt: [{ speaker: "Priya Shah", text: "We should   talk about X." }],
      }),
      TZ,
      false,
    );
    expect(text).toContain(
      'Meeting "Untitled" (32 min, Priya Shah, Tom Brandt)',
    );
    expect(text).toContain("Status: ENDED, no notes recorded");
    expect(text).toContain("- Priya Shah: We should talk about X.");
  });

  it("says a live meeting is in progress", () => {
    const text = renderMeeting(
      meeting({ status: "LIVE", endedAt: null, participants: [] }),
      TZ,
      true,
    );
    expect(text).toContain("(in progress, no transcript)");
  });
});

describe("buildContextMessage", () => {
  const now = new Date("2026-11-11T08:35:00Z");

  it("states today's date and time in the asker's timezone", () => {
    const text = buildContextMessage({ now, tz: TZ, recallBlock: "" });
    expect(text).toContain(
      "Today is Wednesday 2026-11-11 (Asia/Kolkata). Time now: 14:05.",
    );
    expect(text).toContain("No earlier history was recalled for this message.");
  });

  it("appends the recalled block when there is one", () => {
    const text = buildContextMessage({
      now,
      tz: "UTC",
      recallBlock: "NO_MATCHING_HISTORY: nothing.",
    });
    expect(text).toContain(
      "Today is Wednesday 2026-11-11 (UTC). Time now: 08:35.",
    );
    expect(text).toContain("Recalled workspace history:\nNO_MATCHING_HISTORY");
    expect(text).not.toContain("No earlier history");
  });
});

describe("estimateTokens", () => {
  it("is a quarter of the characters, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("message:send time fields", () => {
  const base = { workspaceId: "ws1", content: "hi" };

  it("accepts a known IANA timezone and a clock override", () => {
    const parsed = messageSendSchema.parse({
      ...base,
      timeZone: "Asia/Kolkata",
      clockOverride: "2026-11-11",
    });
    expect(parsed).toMatchObject({
      timeZone: "Asia/Kolkata",
      clockOverride: "2026-11-11",
    });
  });

  it("turns an unknown or malformed timezone into UTC instead of rejecting the message", () => {
    for (const timeZone of ["Mars/Phobos", "", "not a zone", "UTC+99"]) {
      expect(messageSendSchema.parse({ ...base, timeZone }).timeZone).toBe(
        "UTC",
      );
    }
    expect(messageSendSchema.parse(base).timeZone).toBe("UTC");
  });

  it("still refuses an absurdly long value", () => {
    expect(
      messageSendSchema.safeParse({ ...base, timeZone: "x".repeat(65) })
        .success,
    ).toBe(false);
    expect(
      messageSendSchema.safeParse({ ...base, clockOverride: "x".repeat(65) })
        .success,
    ).toBe(false);
  });

  it("normalizeTimeZone keeps valid names as given", () => {
    expect(normalizeTimeZone("America/New_York")).toBe("America/New_York");
    expect(normalizeTimeZone(undefined)).toBe("UTC");
    expect(normalizeTimeZone(null)).toBe("UTC");
  });
});
