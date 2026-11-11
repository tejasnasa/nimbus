/**
 * @module validations/meeting
 * @description Zod schemas for the assistant routes: starting it, finding the
 * live meeting, listing past meetings, paging a transcript and choosing a
 * caption language.
 */
import { z } from "zod";

/** Body of `POST /api/meetings/assistant/start`. */
export const assistantStartSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required").max(64),
});

/** Query of `GET /api/meetings/live`. */
export const liveMeetingQuerySchema = z.object({
  workspaceId: z.string().min(1).max(64),
});

/** Largest page of the meeting history. */
export const MEETING_PAGE_MAX = 50;

/** Query of `GET /api/meetings`: the workspace's meetings, newest first. */
export const meetingListQuerySchema = z.object({
  workspaceId: z.string().min(1).max(64),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(MEETING_PAGE_MAX).default(10),
});

/** Largest transcript page. */
export const SEGMENT_PAGE_MAX = 200;

/** Query of `GET /api/meetings/:meetingId/segments`. */
export const segmentsQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(SEGMENT_PAGE_MAX).default(100),
  /**
   * A caption language code. Whether it is a supported one is checked against
   * the language list by the controller, which this package cannot import.
   */
  language: z.string().min(2).max(8).optional(),
});

/** Payload of the `meeting:caption-language` socket event. */
export const captionLanguageSchema = z.object({
  meetingId: z.string().min(1).max(64),
  language: z.string().min(2).max(8).nullable(),
});

/** Query of `GET /api/meetings/search`. */
export const meetingSearchQuerySchema = z.object({
  workspaceId: z.string().min(1).max(64),
  q: z.string().trim().min(1).max(200),
  sinceDays: z.coerce.number().int().min(1).max(3650).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Largest page of action items. */
export const ACTION_ITEM_PAGE_MAX = 100;

/** Query of `GET /api/action-items`. */
export const actionItemListQuerySchema = z.object({
  workspaceId: z.string().min(1).max(64),
  status: z.enum(["open", "done", "all"]).default("open"),
  owner: z.literal("me").optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(ACTION_ITEM_PAGE_MAX).default(30),
});

/** Longest action item text. */
export const ACTION_ITEM_TEXT_MAX = 500;

/** A calendar date as `YYYY-MM-DD`. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "dueDate must be a real date");

/** Body of `PATCH /api/action-items/:id`; at least one field is required. */
export const actionItemPatchSchema = z
  .object({
    status: z.enum(["OPEN", "DONE"]).optional(),
    ownerUserId: z.string().min(1).max(64).nullable().optional(),
    dueDate: calendarDate.nullable().optional(),
    text: z.string().trim().min(1).max(ACTION_ITEM_TEXT_MAX).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");
