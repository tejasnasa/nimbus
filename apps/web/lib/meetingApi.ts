/**
 * @module web/lib/meetingApi
 * @description Client calls for the in-call assistant: asking whether a
 * workspace has a live meeting, starting and stopping the assistant, listing
 * past meetings and paging a transcript, optionally with stored translations.
 *
 * Failures resolve to `{ ok: false, message }` rather than throwing, matching
 * `lib/voiceApi`, so callers can show the message inline. A refusal to start
 * carries the reason and the settings surface that fixes it.
 */
import type {
  AssistantRefusalDTO,
  LiveMeetingDTO,
  MeetingDTO,
  MeetingListDTO,
  SegmentPageDTO,
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
