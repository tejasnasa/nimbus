/**
 * @module web/lib/meetingApi
 * @description Client calls for the in-call assistant: asking whether a
 * workspace has a live meeting, starting and stopping the assistant, and paging
 * the live transcript.
 *
 * Failures resolve to `{ ok: false, message }` rather than throwing, matching
 * `lib/voiceApi`, so callers can show the message inline. A refusal to start
 * carries the reason and the settings surface that fixes it.
 */
import type {
  AssistantRefusalDTO,
  LiveMeetingDTO,
  MeetingDTO,
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
 */
export function fetchSegments(meetingId: string, afterSeq: number) {
  return call<SegmentPageDTO>(
    `/api/meetings/${encodeURIComponent(meetingId)}/segments?afterSeq=${afterSeq}&limit=100`,
  );
}
