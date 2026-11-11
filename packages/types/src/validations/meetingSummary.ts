/**
 * @module validations/meetingSummary
 * @description The shape the model must return when it writes a meeting's
 * notes, and the limits that keep what it returns storable and displayable.
 *
 * @important Dates are accepted only as real calendar dates in `YYYY-MM-DD`.
 *            A relative phrase ("Friday") is not valid here: the model is given
 *            the meeting's date so it can resolve those itself, and a reply that
 *            does not is rejected and retried with the validation error.
 */
import { z } from "zod";

/** Longest meeting title. */
export const MEETING_TITLE_MAX = 80;

/** Longest summary paragraph. */
export const MEETING_SUMMARY_MAX = 1200;

/** Longest single decision, action item or open question. */
export const MEETING_ITEM_MAX = 500;

/** A `YYYY-MM-DD` string that names a real day. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "must be a real calendar date");

/** A transcript sequence number the model cites as evidence. */
const sourceSeq = z.number().int().min(0).nullish();

/** The notes the model writes for a meeting. */
export const MeetingSummarySchema = z.object({
  title: z.string().trim().min(1).max(MEETING_TITLE_MAX),
  summary: z.string().trim().min(1).max(MEETING_SUMMARY_MAX),
  decisions: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(MEETING_ITEM_MAX),
        sourceSeq,
      }),
    )
    .max(50),
  actionItems: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(MEETING_ITEM_MAX),
        ownerName: z.string().trim().min(1).max(100).nullish(),
        due: isoDate.nullish(),
        sourceSeq,
      }),
    )
    .max(50),
  openQuestions: z
    .array(z.string().trim().min(1).max(MEETING_ITEM_MAX))
    .max(50),
  topics: z.array(z.string().trim().min(1).max(100)).max(30),
});

/** A validated set of meeting notes. */
export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;
