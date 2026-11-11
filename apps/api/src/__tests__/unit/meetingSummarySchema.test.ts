/**
 * @module api/__tests__/unit/meetingSummarySchema
 * @description The shape the model must return for a meeting's notes: valid
 * output is accepted, and over-long fields, malformed or impossible dates and
 * negative sequence numbers are rejected.
 */
import { MeetingSummarySchema } from "@nimbus/types";
import { describe, expect, it } from "vitest";
import { sampleNotes } from "@testhelpers";

describe("MeetingSummarySchema", () => {
  it("accepts a complete, valid reply", () => {
    expect(MeetingSummarySchema.safeParse(sampleNotes()).success).toBe(true);
  });

  it("accepts empty lists and omitted optional fields", () => {
    const parsed = MeetingSummarySchema.safeParse({
      title: "Standup",
      summary: "Short.",
      decisions: [],
      actionItems: [{ text: "Do it" }],
      openQuestions: [],
      topics: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts nulls where a field is optional", () => {
    const parsed = MeetingSummarySchema.safeParse(
      sampleNotes({
        decisions: [{ text: "x", sourceSeq: null }],
        actionItems: [
          { text: "y", ownerName: null, due: null, sourceSeq: null },
        ],
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["title", { title: "t".repeat(81) }],
    ["summary", { summary: "s".repeat(1201) }],
    ["a decision", { decisions: [{ text: "d".repeat(501) }] }],
    ["an action item", { actionItems: [{ text: "a".repeat(501) }] }],
    ["an open question", { openQuestions: ["q".repeat(501)] }],
    ["an empty title", { title: "   " }],
  ])("rejects a too-long or empty %s", (_label, override) => {
    expect(MeetingSummarySchema.safeParse(sampleNotes(override)).success).toBe(
      false,
    );
  });

  it.each([
    ["a relative phrase", "Friday"],
    ["a wrong format", "13/11/2026"],
    ["a date with a time", "2026-11-13T10:00:00Z"],
    ["a day that does not exist", "2026-02-30"],
    ["a month that does not exist", "2026-13-01"],
  ])("rejects %s as a due date", (_label, due) => {
    const parsed = MeetingSummarySchema.safeParse(
      sampleNotes({ actionItems: [{ text: "x", due }] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects negative or fractional source sequence numbers", () => {
    for (const sourceSeq of [-1, 1.5]) {
      expect(
        MeetingSummarySchema.safeParse(
          sampleNotes({ decisions: [{ text: "x", sourceSeq }] }),
        ).success,
      ).toBe(false);
      expect(
        MeetingSummarySchema.safeParse(
          sampleNotes({ actionItems: [{ text: "x", sourceSeq }] }),
        ).success,
      ).toBe(false);
    }
  });

  it("rejects a reply missing a required field", () => {
    const rest: Partial<ReturnType<typeof sampleNotes>> = sampleNotes();
    delete rest.topics;
    expect(MeetingSummarySchema.safeParse(rest).success).toBe(false);
  });
});
