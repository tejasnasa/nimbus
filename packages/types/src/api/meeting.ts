/**
 * @module types/api/meeting
 * @description DTOs for the in-call assistant's meetings and their live
 * transcript, shared by the API (REST and socket payloads) and the web client.
 *
 * @important A meeting exists only while the assistant has been started; a call
 *            without the assistant creates no row. At most one meeting per
 *            workspace is `LIVE` at a time.
 */
import type { MeetingSummary } from "../validations/meetingSummary";
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
  /** The title the notes gave the meeting. Null until they are written. */
  title?: string | null;
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
  /** The title the notes gave the meeting; null until they are written. */
  title: string | null;
  /** The notes document, once written. */
  notesDocumentId: string | null;
};

/** `GET /api/meetings?workspaceId=`: newest first, cursor-paged. */
export type MeetingListDTO = {
  meetings: MeetingSummaryDTO[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
};

/** Whether an action item still needs doing. */
export type ActionItemStatus = "OPEN" | "DONE";

/** A task from a meeting, or added to the workspace directly. */
export type ActionItemDTO = {
  id: string;
  workspaceId: string;
  /** The meeting it came from; null when that meeting was deleted. */
  meetingId: string | null;
  /** Title of that meeting, when it has one. */
  meetingTitle: string | null;
  text: string;
  /** The responsible member, when the spoken name matched exactly one. */
  ownerUserId: string | null;
  /**
   * Who to show as the owner: the linked member's current name, otherwise the
   * name as spoken, otherwise null.
   */
  ownerName: string | null;
  /** Calendar date as `YYYY-MM-DD`, or null. */
  dueDate: string | null;
  status: ActionItemStatus;
  /** Sequence number of the transcript segment it was taken from, if cited. */
  sourceSeq: number | null;
  createdById: string | null;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

/** A decision the notes recorded. */
export type DecisionDTO = {
  id: string;
  meetingId: string;
  text: string;
  /** Sequence number of the transcript segment it was taken from, if cited. */
  sourceSeq: number | null;
};

/** Someone who spoke in a meeting. */
export type MeetingParticipantDTO = {
  /** Null when the spoken name matched no current member. */
  userId: string | null;
  name: string;
};

/** `GET /api/meetings/:meetingId`. */
export type MeetingDetailDTO = MeetingDTO & {
  title: string | null;
  startedByName: string | null;
  segmentCount: number;
  /** The notes, parsed; null until they are written. */
  summary: MeetingSummary | null;
  decisions: DecisionDTO[];
  actionItems: ActionItemDTO[];
  /** Distinct speakers, in the order they first spoke. */
  participants: MeetingParticipantDTO[];
  notesDocumentId: string | null;
  /** Curated reason the notes could not be written, when status is `FAILED`. */
  failureReason: string | null;
};

/** `GET /api/meetings/:meetingId/catch-up`. */
export type CatchUpDTO = {
  /** Bullet-point summary of the meeting so far; null when nothing was said yet. */
  summary: string | null;
  /** Highest transcript sequence number the summary covers. */
  upToSeq: number;
  /** ISO timestamp the summary was written; null when there is none. */
  generatedAt: string | null;
  /** Whole minutes since the meeting started (until it ended, if it has). */
  minutesElapsed: number;
};

/** `GET /api/action-items`: cursor-paged. */
export type ActionItemListDTO = {
  items: ActionItemDTO[];
  /** Pass back as `cursor`; null on the last page. */
  nextCursor: string | null;
};

/** One keyword match in a meeting transcript. */
export type SegmentSearchHitDTO = {
  meetingId: string;
  meetingTitle: string | null;
  /** ISO timestamp. */
  meetingStartedAt: string;
  segmentId: string;
  seq: number;
  speakerName: string;
  startMs: number;
  /**
   * An excerpt of the caption with the matched words wrapped in `<mark>` and
   * `</mark>`. Everything else is raw transcript text, not HTML: render it as
   * text and treat only those two tags as markup.
   */
  snippet: string;
};

/** `GET /api/meetings/search`. */
export type SegmentSearchDTO = {
  hits: SegmentSearchHitDTO[];
};

/**
 * Payload of the `meeting:action-items` event.
 *
 * With a `meetingId`, `items` is the meeting's complete current set and
 * replaces whatever the client holds for it. With `meetingId: null` (an item
 * whose meeting is gone), `items` holds only the changed item: merge it by id.
 * `removedIds` lists items that were deleted.
 */
export type ActionItemsChangedDTO = {
  meetingId: string | null;
  items: ActionItemDTO[];
  removedIds: string[];
};
