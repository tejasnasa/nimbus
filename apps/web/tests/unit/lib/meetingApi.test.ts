/**
 * @module web/tests/unit/lib/meetingApi
 * @description The assistant requests: what each sends, how the envelope is
 * unwrapped, that a refusal keeps its reason and fix, and that every failure
 * becomes a returned message rather than a throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteMeeting,
  drawMeetingDiagram,
  fetchActionItems,
  fetchCatchUp,
  fetchLiveMeeting,
  fetchMeetingDetail,
  fetchMeetings,
  fetchSegments,
  patchActionItem,
  searchMeetings,
  startAssistant,
  stopAssistant,
} from "../../../lib/meetingApi";

const fetchMock = vi.fn();

const envelope = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.NEXT_PUBLIC_BACKEND_URL = "http://api.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lib/meetingApi", () => {
  it("lists a workspace's meetings with the paging parameters", async () => {
    fetchMock.mockResolvedValue(
      envelope({
        success: true,
        responseObject: { meetings: [], nextCursor: null },
      }),
    );

    const first = await fetchMeetings("w 1", null, 10);
    expect(first).toEqual({
      ok: true,
      data: { meetings: [], nextCursor: null },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/api/meetings?workspaceId=w+1&limit=10",
    );

    await fetchMeetings("w1", "m-9", 5);
    expect(fetchMock.mock.calls[1]![0]).toBe(
      "http://api.test/api/meetings?workspaceId=w1&limit=5&cursor=m-9",
    );
  });

  it("asks for the live meeting of a workspace with the session cookie", async () => {
    fetchMock.mockResolvedValue(
      envelope({ success: true, responseObject: { meeting: null } }),
    );

    const result = await fetchLiveMeeting("w 1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/meetings/live?workspaceId=w%201");
    expect(init.credentials).toBe("include");
    expect(result).toEqual({ ok: true, data: { meeting: null } });
  });

  it("posts the workspace id to start the assistant", async () => {
    fetchMock.mockResolvedValue(
      envelope({ success: true, responseObject: { id: "m1" } }, 201),
    );

    const result = await startAssistant("w");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/meetings/assistant/start");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ workspaceId: "w" });
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(result.ok).toBe(true);
  });

  it("keeps the reason and fix of a refusal", async () => {
    fetchMock.mockResolvedValue(
      envelope(
        {
          success: false,
          message: "Add a voice key",
          responseObject: { reason: "no-voice-key", cta: "add-key" },
        },
        403,
      ),
    );

    const result = await startAssistant("w");

    expect(result).toEqual({
      ok: false,
      message: "Add a voice key",
      status: 403,
      refusal: { reason: "no-voice-key", cta: "add-key" },
    });
  });

  it("does not mistake another failure for a refusal", async () => {
    fetchMock.mockResolvedValue(
      envelope({ success: false, message: "Nope", responseObject: null }, 409),
    );

    const result = await startAssistant("w");

    expect(result).toMatchObject({ ok: false, status: 409, refusal: null });
  });

  it("posts to the meeting stop route", async () => {
    fetchMock.mockResolvedValue(
      envelope({ success: true, responseObject: { id: "m/1" } }),
    );

    await stopAssistant("m/1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/meetings/m%2F1/assistant/stop");
    expect(init.method).toBe("POST");
    expect(init.headers).toBeUndefined();
  });

  it("pages the transcript after a sequence number", async () => {
    fetchMock.mockResolvedValue(
      envelope({
        success: true,
        responseObject: { segments: [], hasMore: false },
      }),
    );

    await fetchSegments("m1", 40);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/api/meetings/m1/segments?afterSeq=40&limit=100",
    );
  });

  it("asks for stored translations when a language is given", async () => {
    fetchMock.mockResolvedValue(
      envelope({
        success: true,
        responseObject: { segments: [], hasMore: false },
      }),
    );

    await fetchSegments("m1", 0, "hi");

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/api/meetings/m1/segments?afterSeq=0&limit=100&language=hi",
    );
  });

  it("falls back to a safe message when the response is unusable", async () => {
    fetchMock.mockResolvedValue(envelope({ success: false }, 500));
    expect(await fetchLiveMeeting("w")).toMatchObject({
      ok: false,
      status: 500,
      message: "Something went wrong. Please try again.",
    });

    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await fetchLiveMeeting("w")).toEqual({
      ok: false,
      status: 0,
      message: "Something went wrong. Please try again.",
      refusal: null,
    });
  });

  it("reads one meeting, its catch-up and posts a diagram request by id", async () => {
    fetchMock.mockResolvedValue(
      envelope({ success: true, responseObject: { id: "m/1" } }),
    );

    await fetchMeetingDetail("m/1");
    await fetchCatchUp("m/1");
    await drawMeetingDiagram("m/1");

    expect(fetchMock.mock.calls.map((c) => [c[0], c[1].method])).toEqual([
      ["http://api.test/api/meetings/m%2F1", undefined],
      ["http://api.test/api/meetings/m%2F1/catch-up", undefined],
      ["http://api.test/api/meetings/m%2F1/diagram", "POST"],
    ]);
  });

  it("searches with the workspace, query and limit", async () => {
    fetchMock.mockResolvedValue(
      envelope({ success: true, responseObject: { hits: [] } }),
    );

    await searchMeetings("w1", "launch plan");
    await searchMeetings("w1", "x", 5);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/api/meetings/search?workspaceId=w1&q=launch+plan&limit=20",
    );
    expect(fetchMock.mock.calls[1]![0]).toContain("limit=5");
  });

  it("deletes a meeting by id", async () => {
    fetchMock.mockResolvedValue(
      envelope({ success: true, responseObject: { meetingId: "m1" } }),
    );

    const result = await deleteMeeting("m1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/meetings/m1");
    expect(init.method).toBe("DELETE");
    expect(result.ok).toBe(true);
  });

  it("lists action items for each filter and cursor", async () => {
    fetchMock.mockResolvedValue(
      envelope({
        success: true,
        responseObject: { items: [], nextCursor: null },
      }),
    );

    await fetchActionItems("w1", { status: "open", mine: true }, null, 20);
    await fetchActionItems("w1", { status: "all", mine: false }, "a-9", 20);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/api/action-items?workspaceId=w1&status=open&limit=20&owner=me",
    );
    expect(fetchMock.mock.calls[1]![0]).toBe(
      "http://api.test/api/action-items?workspaceId=w1&status=all&limit=20&cursor=a-9",
    );
  });

  it("patches an action item with only the changed fields", async () => {
    fetchMock.mockResolvedValue(
      envelope({ success: true, responseObject: { id: "a/1" } }),
    );

    await patchActionItem("a/1", { dueDate: null, status: "DONE" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/action-items/a%2F1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ dueDate: null, status: "DONE" });
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });
});
