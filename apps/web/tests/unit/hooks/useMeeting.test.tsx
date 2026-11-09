/**
 * @module web/tests/unit/hooks/useMeeting
 * @description The client view of the assistant: adopting a meeting already
 * live on load, paging its transcript, following socket events, keeping
 * captions ordered and unduplicated, and separating a refusal to start from an
 * ordinary error.
 */
import type { MeetingDTO, SegmentDTO } from "@nimbus/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (payload: never) => void;

const { socketMock, api } = vi.hoisted(() => {
  const listeners = new Map<string, Set<Handler>>();
  return {
    socketMock: {
      on: vi.fn((event: string, handler: Handler) => {
        const set = listeners.get(event) ?? new Set<Handler>();
        set.add(handler);
        listeners.set(event, set);
      }),
      off: vi.fn((event: string, handler: Handler) => {
        listeners.get(event)?.delete(handler);
      }),
      fire: (event: string, payload?: unknown) => {
        listeners.get(event)?.forEach((h) => h(payload as never));
      },
      count: (event: string) => listeners.get(event)?.size ?? 0,
      reset: () => listeners.clear(),
    },
    api: {
      fetchLiveMeeting: vi.fn(),
      fetchSegments: vi.fn(),
      startAssistant: vi.fn(),
      stopAssistant: vi.fn(),
    },
  };
});

vi.mock("../../../lib/socket", () => ({ socket: socketMock }));
vi.mock("../../../lib/meetingApi", () => api);

import { insertSegment, useMeeting } from "../../../hooks/useMeeting";

const meeting = (extra: Partial<MeetingDTO> = {}): MeetingDTO => ({
  id: "m1",
  workspaceId: "w1",
  status: "LIVE",
  source: "BYOK",
  startedById: "u1",
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: null,
  endReason: null,
  budgetSeconds: null,
  lastSeq: 0,
  ...extra,
});

const seg = (seq: number, extra: Partial<SegmentDTO> = {}): SegmentDTO => ({
  id: `s${seq}`,
  meetingId: "m1",
  seq,
  speakerUserId: "u1",
  speakerName: "Ada",
  text: `line ${seq}`,
  startMs: seq * 1000,
  endMs: seq * 1000 + 500,
  language: null,
  ...extra,
});

const okData = <T,>(data: T) => ({ ok: true as const, data });
const failed = (message: string, refusal: unknown = null, status = 400) => ({
  ok: false as const,
  message,
  status,
  refusal,
});

beforeEach(() => {
  socketMock.reset();
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchLiveMeeting.mockResolvedValue(okData({ meeting: null }));
  api.fetchSegments.mockResolvedValue(okData({ segments: [], hasMore: false }));
});

describe("insertSegment", () => {
  it("orders by sequence and ignores a repeat", () => {
    const once = insertSegment(insertSegment([], seg(2)), seg(1));
    expect(once.map((s) => s.seq)).toEqual([1, 2]);
    expect(insertSegment(once, seg(2))).toBe(once);
  });
});

describe("useMeeting", () => {
  it("starts with no meeting when none is live", async () => {
    const { result } = renderHook(() => useMeeting("w1"));

    await waitFor(() =>
      expect(api.fetchLiveMeeting).toHaveBeenCalledWith("w1"),
    );
    expect(result.current.meeting).toBeNull();
    expect(result.current.segments).toEqual([]);
  });

  it("adopts a live meeting and pages its transcript", async () => {
    api.fetchLiveMeeting.mockResolvedValue(okData({ meeting: meeting() }));
    api.fetchSegments
      .mockResolvedValueOnce(
        okData({ segments: [seg(1), seg(2)], hasMore: true }),
      )
      .mockResolvedValueOnce(okData({ segments: [seg(3)], hasMore: false }));

    const { result } = renderHook(() => useMeeting("w1"));

    await waitFor(() => expect(result.current.segments).toHaveLength(3));
    expect(api.fetchSegments).toHaveBeenNthCalledWith(1, "m1", 0);
    expect(api.fetchSegments).toHaveBeenNthCalledWith(2, "m1", 2);
    expect(result.current.meeting?.id).toBe("m1");
    expect(result.current.assistantState).toBe("joining");
  });

  it("stops paging when a page fails", async () => {
    api.fetchLiveMeeting.mockResolvedValue(okData({ meeting: meeting() }));
    api.fetchSegments.mockResolvedValue(failed("boom", null, 500));

    const { result } = renderHook(() => useMeeting("w1"));

    await waitFor(() => expect(api.fetchSegments).toHaveBeenCalledTimes(1));
    expect(result.current.segments).toEqual([]);
  });

  it("follows the socket through a whole meeting", () => {
    const { result } = renderHook(() => useMeeting("w1"));

    act(() => socketMock.fire("meeting:started", meeting()));
    expect(result.current.meeting?.id).toBe("m1");

    act(() =>
      socketMock.fire("meeting:assistant-state", {
        meetingId: "m1",
        state: "listening",
      }),
    );
    expect(result.current.assistantState).toBe("listening");

    act(() =>
      socketMock.fire("meeting:speaking", { meetingId: "m1", userIds: ["u1"] }),
    );
    expect(result.current.speakingUserIds).toEqual(["u1"]);

    act(() => {
      socketMock.fire("meeting:segment", { meetingId: "m1", segment: seg(2) });
      socketMock.fire("meeting:segment", { meetingId: "m1", segment: seg(1) });
      socketMock.fire("meeting:segment", { meetingId: "m1", segment: seg(1) });
    });
    expect(result.current.segments.map((s) => s.seq)).toEqual([1, 2]);

    act(() =>
      socketMock.fire("meeting:ended", { meetingId: "m1", reason: "budget" }),
    );
    expect(result.current.meeting).toBeNull();
    expect(result.current.assistantState).toBeNull();
    expect(result.current.speakingUserIds).toEqual([]);
    expect(result.current.endReason).toBe("budget");
    expect(result.current.segments).toHaveLength(2);
  });

  it("ignores events for other meetings and other workspaces", () => {
    const { result } = renderHook(() => useMeeting("w1"));

    act(() =>
      socketMock.fire("meeting:started", meeting({ workspaceId: "w2" })),
    );
    expect(result.current.meeting).toBeNull();

    act(() => socketMock.fire("meeting:started", meeting()));
    act(() => {
      socketMock.fire("meeting:segment", {
        meetingId: "other",
        segment: seg(1),
      });
      socketMock.fire("meeting:assistant-state", {
        meetingId: "other",
        state: "thinking",
      });
      socketMock.fire("meeting:speaking", {
        meetingId: "other",
        userIds: ["x"],
      });
      socketMock.fire("meeting:ended", {
        meetingId: "other",
        reason: "stopped",
      });
    });

    expect(result.current.segments).toEqual([]);
    expect(result.current.assistantState).toBe("joining");
    expect(result.current.speakingUserIds).toEqual([]);
    expect(result.current.meeting?.id).toBe("m1");
  });

  it("clears the transcript when a different meeting starts", () => {
    const { result } = renderHook(() => useMeeting("w1"));
    act(() => socketMock.fire("meeting:started", meeting()));
    act(() =>
      socketMock.fire("meeting:segment", { meetingId: "m1", segment: seg(1) }),
    );

    act(() => socketMock.fire("meeting:started", meeting({ id: "m2" })));

    expect(result.current.segments).toEqual([]);
    expect(result.current.endReason).toBeNull();
  });

  it("starts the assistant and adopts the meeting it returns", async () => {
    api.startAssistant.mockResolvedValue(okData(meeting()));
    const { result } = renderHook(() => useMeeting("w1"));

    await act(() => result.current.start());

    expect(api.startAssistant).toHaveBeenCalledWith("w1");
    expect(result.current.meeting?.id).toBe("m1");
    expect(result.current.isPending).toBe(false);
  });

  it("keeps a refusal apart from an ordinary error", async () => {
    api.startAssistant.mockResolvedValueOnce(
      failed("Add a key", { reason: "no-voice-key", cta: "add-key" }, 403),
    );
    const { result } = renderHook(() => useMeeting("w1"));

    await act(() => result.current.start());
    expect(result.current.refusal).toEqual({
      reason: "no-voice-key",
      cta: "add-key",
      message: "Add a key",
    });
    expect(result.current.error).toBeNull();

    api.startAssistant.mockResolvedValueOnce(failed("Try later", null, 502));
    await act(() => result.current.start());
    expect(result.current.refusal).toBeNull();
    expect(result.current.error).toBe("Try later");
  });

  it("stops the live meeting, and does nothing without one", async () => {
    const { result } = renderHook(() => useMeeting("w1"));
    await act(() => result.current.stop());
    expect(api.stopAssistant).not.toHaveBeenCalled();

    act(() => socketMock.fire("meeting:started", meeting()));
    api.stopAssistant.mockResolvedValue(failed("Could not stop"));
    await act(() => result.current.stop());

    expect(api.stopAssistant).toHaveBeenCalledWith("m1");
    expect(result.current.error).toBe("Could not stop");
  });

  it("removes its listeners on unmount", () => {
    const { unmount } = renderHook(() => useMeeting("w1"));
    expect(socketMock.count("meeting:segment")).toBe(1);

    unmount();

    for (const event of [
      "meeting:started",
      "meeting:ended",
      "meeting:assistant-state",
      "meeting:speaking",
      "meeting:segment",
    ]) {
      expect(socketMock.count(event)).toBe(0);
    }
  });
});
