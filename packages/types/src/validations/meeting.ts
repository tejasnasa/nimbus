/**
 * @module validations/meeting
 * @description Zod schemas for the assistant routes: starting it, finding the
 * live meeting, listing past meetings and paging a transcript.
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
});
