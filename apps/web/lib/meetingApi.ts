/**
 * @module web/lib/meetingApi
 * @description Client calls for the in-call assistant: asking whether a
 * workspace has a live meeting, starting and stopping the assistant, listing
 * past meetings and paging a transcript, optionally with stored translations.
 * Also the meeting brain: one meeting's notes, the catch-up summary, keyword
 * search across transcripts, drawing a meeting as a canvas, deleting a meeting
 * and the workspace's action items.
 *
 * Failures resolve to `{ ok: false, message }` rather than throwing, matching
 * `lib/voiceApi`, so callers can show the message inline. A refusal to start
 * carries the reason and the settings surface that fixes it.
 */
import type {
  ActionItemDTO,
  ActionItemListDTO,
  AssistantRefusalDTO,
  CatchUpDTO,
  LiveMeetingDTO,
  MeetingDetailDTO,
  MeetingDTO,
  MeetingListDTO,
  SegmentPageDTO,
  SegmentSearchDTO,
} from "@nimbus/types";

/** A call that either produced `data` or a message safe to show. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      message: string;
      status: number;
      refusal: AssistantRefusalDTO | null;
    };

const FALLBACK = "Something went wrong. Please try again.";

interface Envelope<T> {
  success?: boolean;
  message?: string;
  responseObject?: T;
}

async function call<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}${path}`, {
      credentials: "include",
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
    const body = (await res.json()) as Envelope<T>;
    if (!res.ok || !body.success || body.responseObject === undefined) {
      const refusal =
        res.status === 403 &&
        body.responseObject &&
        typeof body.responseObject === "object" &&
        "reason" in body.responseObject
          ? (body.responseObject as unknown as AssistantRefusalDTO)
          : null;
      return {
        ok: false,
        message: body.message || FALLBACK,
        status: res.status,
        refusal,
      };
    }
    return { ok: true, data: body.responseObject };
  } catch {
    return { ok: false, message: FALLBACK, status: 0, refusal: null };
  }
}

/**
 * Reads the workspace's live meeting, if any.
 *
 * @param workspaceId - The workspace cuid.
 */
export function fetchLiveMeeting(workspaceId: string) {
  return call<LiveMeetingDTO>(
    `/api/meetings/live?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}

/**
 * Reads one page of the workspace's meetings, newest first.
 *
 * @param workspaceId - The workspace cuid.
 * @param cursor - The previous page's `nextCursor`, or null for the first page.
 * @param limit - Meetings per page.
 */
export function fetchMeetings(
  workspaceId: string,
  cursor: string | null,
  limit: number,
) {
  const params = new URLSearchParams({ workspaceId, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return call<MeetingListDTO>(`/api/meetings?${params.toString()}`);
}

/**
 * Starts the assistant in the workspace's call.
 *
 * @param workspaceId - The workspace cuid.
 */
export function startAssistant(workspaceId: string) {
  return call<MeetingDTO>("/api/meetings/assistant/start", {
    method: "POST",
    body: JSON.stringify({ workspaceId }),
  });
}

/**
 * Asks the assistant to leave.
 *
 * @param meetingId - The live meeting.
 */
export function stopAssistant(meetingId: string) {
  return call<MeetingDTO>(
    `/api/meetings/${encodeURIComponent(meetingId)}/assistant/stop`,
    { method: "POST" },
  );
}

/**
 * Reads one page of a meeting's transcript.
 *
 * @param meetingId - The meeting.
 * @param afterSeq - Return segments with a higher sequence number.
 * @param language - A caption language code to include stored translations in,
 *                   or null/omitted for the original text only.
 */
export function fetchSegments(
  meetingId: string,
  afterSeq: number,
  language: string | null = null,
) {
  const suffix = language ? `&language=${encodeURIComponent(language)}` : "";
  return call<SegmentPageDTO>(
    `/api/meetings/${encodeURIComponent(meetingId)}/segments?afterSeq=${afterSeq}&limit=100${suffix}`,
  );
}

/**
 * Reads one meeting with its notes, decisions, action items and participants.
 *
 * @param meetingId - The meeting.
 */
export function fetchMeetingDetail(meetingId: string) {
  return call<MeetingDetailDTO>(
    `/api/meetings/${encodeURIComponent(meetingId)}`,
  );
}

/**
 * Reads the "so far" summary of a meeting for someone who joined late.
 *
 * @param meetingId - The meeting.
 */
export function fetchCatchUp(meetingId: string) {
  return call<CatchUpDTO>(
    `/api/meetings/${encodeURIComponent(meetingId)}/catch-up`,
  );
}

/**
 * Searches the workspace's transcripts by keyword.
 *
 * @param workspaceId - The workspace cuid.
 * @param query - The words to look for.
 * @param limit - Most hits to return.
 */
export function searchMeetings(workspaceId: string, query: string, limit = 20) {
  const params = new URLSearchParams({ workspaceId, q: query });
  params.set("limit", String(limit));
  return call<SegmentSearchDTO>(`/api/meetings/search?${params.toString()}`);
}

/**
 * Asks NimbusBot to draw a meeting's discussion as a new canvas. Progress
 * arrives over the document generation socket events.
 *
 * @param meetingId - The meeting, which must have notes.
 */
export function drawMeetingDiagram(meetingId: string) {
  return call<{ started: true; label: string }>(
    `/api/meetings/${encodeURIComponent(meetingId)}/diagram`,
    { method: "POST" },
  );
}

/**
 * Deletes an ended meeting along with its transcript and notes.
 *
 * @param meetingId - The meeting.
 */
export function deleteMeeting(meetingId: string) {
  return call<{ meetingId: string }>(
    `/api/meetings/${encodeURIComponent(meetingId)}`,
    { method: "DELETE" },
  );
}

/** Which action items a list shows. */
export type ActionItemFilter = {
  status: "open" | "done" | "all";
  /** Only items assigned to the viewer. */
  mine: boolean;
};

/**
 * Reads one page of the workspace's action items.
 *
 * @param workspaceId - The workspace cuid.
 * @param filter - Status and ownership filter.
 * @param cursor - The previous page's `nextCursor`, or null for the first page.
 * @param limit - Items per page.
 */
export function fetchActionItems(
  workspaceId: string,
  filter: ActionItemFilter,
  cursor: string | null,
  limit: number,
) {
  const params = new URLSearchParams({
    workspaceId,
    status: filter.status,
    limit: String(limit),
  });
  if (filter.mine) params.set("owner", "me");
  if (cursor) params.set("cursor", cursor);
  return call<ActionItemListDTO>(`/api/action-items?${params.toString()}`);
}

/** The fields of an action item a member can change. */
export type ActionItemChange = {
  status?: "OPEN" | "DONE";
  ownerUserId?: string | null;
  /** `YYYY-MM-DD`, or null to clear. */
  dueDate?: string | null;
  text?: string;
};

/**
 * Changes an action item.
 *
 * @param itemId - The action item.
 * @param change - The fields to change.
 */
export function patchActionItem(itemId: string, change: ActionItemChange) {
  return call<ActionItemDTO>(
    `/api/action-items/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(change),
    },
  );
}
