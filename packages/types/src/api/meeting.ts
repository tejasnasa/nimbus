/**
 * @module types/api/meeting
 * @description DTOs for the in-call assistant's meetings and their live
 * transcript, shared by the API (REST and socket payloads) and the web client.
 *
 * @important A meeting exists only while the assistant has been started; a call
 *            without the assistant creates no row. At most one meeting per
 *            workspace is `LIVE` at a time.
 */
import type { AiVoiceUnavailableReason } from "./ai";

/** Lifecycle of a meeting. `SUMMARIZED` and `FAILED` are set after it ends. */
export type MeetingStatus = "LIVE" | "ENDED" | "SUMMARIZED" | "FAILED";

/** Whose budget pays for the assistant. */
export type MeetingSource = "BYOK" | "FREE";

/**
 * Why a meeting ended. A closed set so the UI can phrase each one.
 *
 * - `stopped`: someone pressed Stop Nimbus.
 * - `budget`: the free assistant time ran out.
 * - `agent-left`: the agent left the room (empty room, crash, removal).
 * - `room-finished`: the media room closed.
 * - `agent-ended`: the agent reported its own exit.
 * - `invalid-key`: the voice key was rejected by the provider.
 * - `spend-cap`: the workspace's monthly spend cap was reached.
 * - `orphaned`: found live at boot with no room behind it.
 * - `dispatch-failed`: the agent could not be started (status `FAILED`).
 */
export type MeetingEndReason =
  | "stopped"
  | "budget"
  | "agent-left"
  | "room-finished"
  | "agent-ended"
  | "invalid-key"
  | "spend-cap"
  | "orphaned"
  | "dispatch-failed";

/** What the assistant is doing right now, for the call UI. */
export type AssistantState =
  | "joining"
  | "listening"
  | "thinking"
  | "speaking"
  | "stopped";

/** A meeting as clients see it. */
export type MeetingDTO = {
  id: string;
  workspaceId: string;
  status: MeetingStatus;
  source: MeetingSource;
  startedById: string | null;
  /** ISO timestamp. */
  startedAt: string;
  /** ISO timestamp, or null while live. */
  endedAt: string | null;
  endReason: MeetingEndReason | null;
  /** Seconds of free assistant time handed to the agent. Null for BYOK. */
  budgetSeconds: number | null;
  /** Highest transcript sequence number stored so far. */
  lastSeq: number;
};

/** One caption: a transcribed utterance. */
export type SegmentDTO = {
  id: string;
  meetingId: string;
  /** Monotonic per meeting; the order people finished speaking in. */
  seq: number;
  /** The speaker's user id, or null when the name matched no current member. */
  speakerUserId: string | null;
  speakerName: string;
  text: string;
  /** Milliseconds from the meeting's start. */
  startMs: number;
  endMs: number;
  language: string | null;
  /**
   * The text in the language the request named with `?language=`. Absent
   * unless one was requested; null when that segment has no stored translation.
   */
  translation?: string | null;
};

/** The reason and the fix when the assistant cannot be started. */
export type AssistantRefusalDTO = {
  reason: AiVoiceUnavailableReason;
  /** Which settings surface can fix it, if any. */
  cta: "add-key" | "manage-ai" | null;
};

/** `GET /api/meetings/:meetingId/segments`. */
export type SegmentPageDTO = {
  segments: SegmentDTO[];
  /** True when more segments exist after the last one returned. */
  hasMore: boolean;
};

/** `GET /api/meetings/live`. */
export type LiveMeetingDTO = {
  meeting: MeetingDTO | null;
};

/** A past or running meeting in the workspace's transcript history. */
export type MeetingSummaryDTO = MeetingDTO & {
  /** Display name of whoever started the assistant, or null if they left. */
  startedByName: string | null;
  /** Transcript segments stored for the meeting. */
  segmentCount: number;
};

/** `GET /api/meetings?workspaceId=`: newest first, cursor-paged. */
export type MeetingListDTO = {
  meetings: MeetingSummaryDTO[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
};
