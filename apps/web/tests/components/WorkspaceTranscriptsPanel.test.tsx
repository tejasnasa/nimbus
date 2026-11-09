/**
 * @module web/tests/components/WorkspaceTranscriptsPanel
 * @description The settings Transcripts tab and its hook: meetings listed newest
 * first with duration, starter and line count, a meeting opened into its full
 * transcript (read across pages, fetched once, retried after a failure), and
 * the list paged with Previous and Next.
 */
import "./testUtils";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { MeetingSummaryDTO, SegmentDTO } from "@nimbus/types";
import WorkspaceTranscriptsPanel from "../../components/WorkspaceTranscriptsPanel";
import { useWorkspaceMeetings } from "../../hooks/useWorkspaceMeetings";
import { BACKEND_URL, fail, ok } from "../msw/handlers";
import { server } from "../msw/server";
import { preflight } from "./testUtils";

const WS = "cm_workspace_0000000000000";
const MEETINGS = `${BACKEND_URL}/api/meetings`;
const segmentsRoute = (meetingId: string) =>
  `${BACKEND_URL}/api/meetings/${meetingId}/segments`;

const meeting = (
  overrides: Partial<MeetingSummaryDTO> = {},
): MeetingSummaryDTO => ({
  id: "m-1",
  workspaceId: WS,
  status: "ENDED",
  source: "BYOK",
  startedById: "user-1",
  startedAt: "2026-11-01T09:00:00.000Z",
  endedAt: "2026-11-01T09:12:00.000Z",
  endReason: "stopped",
  budgetSeconds: null,
  lastSeq: 2,
  startedByName: "Ada Lovelace",
  segmentCount: 2,
  ...overrides,
});

const segment = (seq: number, text: string): SegmentDTO => ({
  id: `s-${seq}`,
  meetingId: "m-1",
  seq,
  speakerUserId: "user-1",
  speakerName: "Ada Lovelace",
  text,
  startMs: seq * 65_000,
  endMs: seq * 65_000 + 2_000,
  language: null,
});

beforeEach(() => {
  server.resetHandlers();
  server.use(preflight);
});

describe("WorkspaceTranscriptsPanel", () => {
  it("lists meetings with their duration, starter and line count", async () => {
    server.use(
      http.get(MEETINGS, () =>
        ok({
          meetings: [
            meeting(),
            meeting({
              id: "m-2",
              endedAt: null,
              status: "LIVE",
              startedByName: null,
              segmentCount: 1,
            }),
          ],
          nextCursor: null,
        }),
      ),
    );
    render(<WorkspaceTranscriptsPanel workspaceId={WS} />);

    const first = await screen.findByTestId("transcript-meeting-m-1");
    expect(first).toHaveTextContent("12 min");
    expect(first).toHaveTextContent("started by Ada Lovelace");
    expect(first).toHaveTextContent("2 lines");
    const live = screen.getByTestId("transcript-meeting-m-2");
    expect(live).toHaveTextContent("Live now");
    expect(live).toHaveTextContent("1 line");
    expect(live).not.toHaveTextContent("started by");
    expect(
      screen.queryByTestId("transcripts-pagination"),
    ).not.toBeInTheDocument();
  });

  it("describes short and long meetings", async () => {
    server.use(
      http.get(MEETINGS, () =>
        ok({
          meetings: [
            meeting({ id: "short", endedAt: "2026-11-01T09:00:20.000Z" }),
            meeting({ id: "long", endedAt: "2026-11-01T10:05:00.000Z" }),
          ],
          nextCursor: null,
        }),
      ),
    );
    render(<WorkspaceTranscriptsPanel workspaceId={WS} />);

    expect(
      await screen.findByTestId("transcript-meeting-short"),
    ).toHaveTextContent("Under a minute");
    expect(screen.getByTestId("transcript-meeting-long")).toHaveTextContent(
      "1 h 5 min",
    );
  });

  it("explains an empty history", async () => {
    server.use(
      http.get(MEETINGS, () => ok({ meetings: [], nextCursor: null })),
    );
    render(<WorkspaceTranscriptsPanel workspaceId={WS} />);

    expect(await screen.findByTestId("transcripts-empty")).toBeInTheDocument();
  });

  it("shows why the history could not be read", async () => {
    server.use(http.get(MEETINGS, () => fail(404, "Workspace not found")));
    render(<WorkspaceTranscriptsPanel workspaceId={WS} />);

    expect(await screen.findByTestId("transcripts-error")).toHaveTextContent(
      "Workspace not found",
    );
  });

  it("opens a meeting into its transcript and closes it again", async () => {
    server.use(
      http.get(MEETINGS, () => ok({ meetings: [meeting()], nextCursor: null })),
      http.get(segmentsRoute("m-1"), () =>
        ok({
          segments: [segment(1, "Hello there"), segment(2, "Shall we start")],
          hasMore: false,
        }),
      ),
    );
    render(<WorkspaceTranscriptsPanel workspaceId={WS} />);
    const user = userEvent.setup();

    const toggle = await screen.findByRole("button", { expanded: false });
    await user.click(toggle);

    const lines = await screen.findByTestId("transcript-lines");
    expect(lines).toHaveTextContent("1:05");
    expect(lines).toHaveTextContent("Ada Lovelace: Hello there");
    expect(lines).toHaveTextContent("Shall we start");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(screen.queryByTestId("transcript-lines")).not.toBeInTheDocument();
  });

  it("says when a meeting has nothing transcribed", async () => {
    server.use(
      http.get(MEETINGS, () =>
        ok({ meetings: [meeting({ segmentCount: 0 })], nextCursor: null }),
      ),
      http.get(segmentsRoute("m-1"), () =>
        ok({ segments: [], hasMore: false }),
      ),
    );
    render(<WorkspaceTranscriptsPanel workspaceId={WS} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { expanded: false }));

    expect(
      await screen.findByText("Nothing was transcribed in this meeting."),
    ).toBeInTheDocument();
  });

  it("shows why a transcript could not be read", async () => {
    server.use(
      http.get(MEETINGS, () => ok({ meetings: [meeting()], nextCursor: null })),
      http.get(segmentsRoute("m-1"), () => fail(500, "Transcript unavailable")),
    );
    render(<WorkspaceTranscriptsPanel workspaceId={WS} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { expanded: false }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transcript unavailable",
    );
  });

  it("pages the meeting list with Next and Previous", async () => {
    server.use(
      http.get(MEETINGS, ({ request }) =>
        new URL(request.url).searchParams.get("cursor")
          ? ok({ meetings: [meeting({ id: "older" })], nextCursor: null })
          : ok({ meetings: [meeting({ id: "newer" })], nextCursor: "newer" }),
      ),
    );
    render(<WorkspaceTranscriptsPanel workspaceId={WS} />);
    const user = userEvent.setup();

    await screen.findByTestId("transcript-meeting-newer");
    await user.click(screen.getByTestId("transcripts-pagination-next"));
    await screen.findByTestId("transcript-meeting-older");
    expect(screen.getByTestId("transcripts-pagination-page")).toHaveTextContent(
      "Page 2",
    );

    await user.click(screen.getByTestId("transcripts-pagination-previous"));
    await screen.findByTestId("transcript-meeting-newer");
  });
});

describe("useWorkspaceMeetings", () => {
  it("asks for the workspace's first page", async () => {
    const queries: string[] = [];
    server.use(
      http.get(MEETINGS, ({ request }) => {
        queries.push(new URL(request.url).search);
        return ok({ meetings: [meeting()], nextCursor: null });
      }),
    );
    const { result } = renderHook(() => useWorkspaceMeetings(WS));

    await waitFor(() => expect(result.current.meetings).toHaveLength(1));
    expect(queries[0]).toContain(`workspaceId=${WS}`);
    expect(queries[0]).toContain("limit=10");
    expect(queries[0]).not.toContain("cursor=");
  });

  it("reads a long transcript across pages and fetches it only once", async () => {
    const afters: string[] = [];
    server.use(
      http.get(MEETINGS, () => ok({ meetings: [meeting()], nextCursor: null })),
      http.get(segmentsRoute("m-1"), ({ request }) => {
        const after = new URL(request.url).searchParams.get("afterSeq")!;
        afters.push(after);
        return after === "0"
          ? ok({ segments: [segment(1, "one")], hasMore: true })
          : ok({ segments: [segment(2, "two")], hasMore: false });
      }),
    );
    const { result } = renderHook(() => useWorkspaceMeetings(WS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadTranscript("m-1");
    });
    await act(async () => {
      await result.current.loadTranscript("m-1");
    });

    expect(result.current.transcripts["m-1"]).toMatchObject({
      kind: "ready",
      segments: [{ text: "one" }, { text: "two" }],
    });
    expect(afters).toEqual(["0", "1"]);
  });

  it("retries a transcript after it failed", async () => {
    let hits = 0;
    server.use(
      http.get(MEETINGS, () => ok({ meetings: [meeting()], nextCursor: null })),
      http.get(segmentsRoute("m-1"), () => {
        hits += 1;
        return hits === 1
          ? fail(500, "Boom")
          : ok({ segments: [segment(1, "back")], hasMore: false });
      }),
    );
    const { result } = renderHook(() => useWorkspaceMeetings(WS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadTranscript("m-1");
    });
    expect(result.current.transcripts["m-1"]).toEqual({
      kind: "error",
      message: "Boom",
    });

    await act(async () => {
      await result.current.loadTranscript("m-1");
    });
    expect(result.current.transcripts["m-1"]).toMatchObject({ kind: "ready" });
  });

  it("keeps the current page when the next one fails, and stops at both ends", async () => {
    let hits = 0;
    server.use(
      http.get(MEETINGS, ({ request }) => {
        hits += 1;
        return new URL(request.url).searchParams.get("cursor")
          ? fail(500, "Boom")
          : ok({ meetings: [meeting()], nextCursor: "m-1" });
      }),
    );
    const { result } = renderHook(() => useWorkspaceMeetings(WS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.previousPage();
    });
    expect(hits).toBe(1);

    await act(async () => {
      await result.current.nextPage();
    });
    expect(result.current.page).toBe(1);
    expect(result.current.meetings).toHaveLength(1);
    expect(result.current.error).toBe("Boom");
  });
});
