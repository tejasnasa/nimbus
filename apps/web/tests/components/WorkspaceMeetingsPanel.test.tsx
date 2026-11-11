/**
 * @module web/tests/components/WorkspaceMeetingsPanel
 * @description The settings Meetings tab: the meeting list (titles, statuses,
 * duration, paging, empty and error states, live refresh over the socket),
 * keyword search with snippets rendered as text and highlights only, opening a
 * hit at its transcript line, the switch to the action items view, and a
 * meeting deleted from elsewhere while it is open.
 */
import "./testUtils";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";
import WorkspaceMeetingsPanel from "../../components/WorkspaceMeetingsPanel";
import { BACKEND_URL, fail, ok } from "../msw/handlers";
import {
  actionItem,
  meetingDetail,
  meetingRow,
  members,
  segment,
  WS,
} from "../msw/meetingFixtures";
import { server } from "../msw/server";
import { fakeSocket } from "./fakeSocket";
import { preflight } from "./testUtils";

vi.mock(
  "../../lib/socket",
  async () => (await import("./fakeSocket")).socketModule,
);

const MEETINGS = `${BACKEND_URL}/api/meetings`;

function renderPanel(userId = "user-1") {
  return render(
    <DocEditorRefProvider>
      <WorkspaceMeetingsPanel
        workspaceId={WS}
        userId={userId}
        members={members}
      />
    </DocEditorRefProvider>,
  );
}

/** Answers the detail and transcript requests of meeting `m-1`. */
function useMeetingRoutes(detail = meetingDetail()) {
  server.use(
    http.get(`${MEETINGS}/m-1`, () => ok(detail)),
    http.get(`${MEETINGS}/m-1/segments`, () =>
      ok({
        segments: [segment(1, "Hello there"), segment(2, "Shall we start")],
        hasMore: false,
      }),
    ),
  );
}

beforeEach(() => {
  fakeSocket.reset();
  window.localStorage.clear();
  server.resetHandlers();
  server.use(preflight);
});

describe("WorkspaceMeetingsPanel: the list", () => {
  it("shows titles, a fallback name, duration, starter, lines and status", async () => {
    server.use(
      http.get(MEETINGS, () =>
        ok({
          meetings: [
            meetingRow({
              status: "SUMMARIZED",
              title: "Launch sync",
              notesDocumentId: "doc-1",
            }),
            meetingRow({
              id: "m-2",
              endedAt: null,
              status: "LIVE",
              startedByName: null,
              segmentCount: 1,
            }),
            meetingRow({ id: "m-3", status: "ENDED" }),
            meetingRow({ id: "m-4", status: "FAILED" }),
          ],
          nextCursor: null,
        }),
      ),
    );
    renderPanel();

    const first = await screen.findByTestId("meeting-row-m-1");
    expect(first).toHaveTextContent("Launch sync");
    expect(first).toHaveTextContent("12 min");
    expect(first).toHaveTextContent("started by Ada Lovelace");
    expect(first).toHaveTextContent("2 lines");
    expect(within(first).getByTestId("meeting-row-status")).toHaveTextContent(
      "Notes ready",
    );

    const live = screen.getByTestId("meeting-row-m-2");
    expect(live).toHaveTextContent("Untitled meeting");
    expect(live).toHaveTextContent("Live now");
    expect(live).toHaveTextContent("1 line");
    expect(live).not.toHaveTextContent("started by");
    expect(within(live).getByTestId("meeting-row-status")).toHaveTextContent(
      "Live",
    );

    expect(
      within(screen.getByTestId("meeting-row-m-3")).getByTestId(
        "meeting-row-status",
      ),
    ).toHaveTextContent("Writing notes…");
    expect(
      within(screen.getByTestId("meeting-row-m-4")).getByTestId(
        "meeting-row-status",
      ),
    ).toHaveTextContent("Notes failed");
    expect(screen.queryByTestId("meetings-pagination")).not.toBeInTheDocument();
  });

  it("describes short and long meetings", async () => {
    server.use(
      http.get(MEETINGS, () =>
        ok({
          meetings: [
            meetingRow({ id: "short", endedAt: "2026-11-01T09:00:20.000Z" }),
            meetingRow({ id: "long", endedAt: "2026-11-01T10:05:00.000Z" }),
          ],
          nextCursor: null,
        }),
      ),
    );
    renderPanel();

    expect(await screen.findByTestId("meeting-row-short")).toHaveTextContent(
      "Under a minute",
    );
    expect(screen.getByTestId("meeting-row-long")).toHaveTextContent(
      "1 h 5 min",
    );
  });

  it("explains an empty history", async () => {
    server.use(
      http.get(MEETINGS, () => ok({ meetings: [], nextCursor: null })),
    );
    renderPanel();

    expect(await screen.findByTestId("meetings-empty")).toBeInTheDocument();
  });

  it("shows why the history could not be read", async () => {
    server.use(http.get(MEETINGS, () => fail(404, "Workspace not found")));
    renderPanel();

    expect(await screen.findByTestId("meetings-error")).toHaveTextContent(
      "Workspace not found",
    );
  });

  it("pages the list with Next and Previous", async () => {
    server.use(
      http.get(MEETINGS, ({ request }) =>
        new URL(request.url).searchParams.get("cursor")
          ? ok({ meetings: [meetingRow({ id: "older" })], nextCursor: null })
          : ok({
              meetings: [meetingRow({ id: "newer" })],
              nextCursor: "newer",
            }),
      ),
    );
    renderPanel();
    const user = userEvent.setup();

    await screen.findByTestId("meeting-row-newer");
    await user.click(screen.getByTestId("meetings-pagination-next"));
    await screen.findByTestId("meeting-row-older");
    expect(screen.getByTestId("meetings-pagination-page")).toHaveTextContent(
      "Page 2",
    );

    await user.click(screen.getByTestId("meetings-pagination-previous"));
    await screen.findByTestId("meeting-row-newer");
  });

  it("keeps the page when the next one fails", async () => {
    server.use(
      http.get(MEETINGS, ({ request }) =>
        new URL(request.url).searchParams.get("cursor")
          ? fail(500, "Boom")
          : ok({ meetings: [meetingRow()], nextCursor: "m-1" }),
      ),
    );
    renderPanel();
    const user = userEvent.setup();

    await screen.findByTestId("meeting-row-m-1");
    await user.click(screen.getByTestId("meetings-pagination-next"));

    expect(await screen.findByTestId("meetings-error")).toHaveTextContent(
      "Boom",
    );
    expect(screen.getByTestId("meeting-row-m-1")).toBeInTheDocument();
  });

  it("refreshes a row's status when the notes are ready", async () => {
    let calls = 0;
    server.use(
      http.get(MEETINGS, () => {
        calls += 1;
        return ok({
          meetings: [
            calls === 1
              ? meetingRow()
              : meetingRow({ status: "SUMMARIZED", title: "Launch sync" }),
          ],
          nextCursor: null,
        });
      }),
    );
    renderPanel();

    expect(await screen.findByText("Writing notes…")).toBeInTheDocument();
    act(() => {
      fakeSocket.fire("meeting:notes-ready", {
        meetingId: "m-1",
        documentId: "doc-1",
      });
    });

    expect(await screen.findByText("Notes ready")).toBeInTheDocument();
    expect(screen.getByTestId("meeting-row-m-1")).toHaveTextContent(
      "Launch sync",
    );
  });

  it("drops a deleted meeting from the list", async () => {
    server.use(
      http.get(MEETINGS, () =>
        ok({
          meetings: [meetingRow(), meetingRow({ id: "m-2" })],
          nextCursor: null,
        }),
      ),
    );
    renderPanel();
    await screen.findByTestId("meeting-row-m-2");

    act(() => fakeSocket.fire("meeting:deleted", { meetingId: "m-2" }));

    expect(screen.queryByTestId("meeting-row-m-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("meeting-row-m-1")).toBeInTheDocument();
  });

  it("stops listening to the socket when it unmounts", async () => {
    server.use(
      http.get(MEETINGS, () => ok({ meetings: [], nextCursor: null })),
    );
    const view = renderPanel();
    await screen.findByTestId("meetings-empty");
    expect(fakeSocket.listenerCount("meeting:notes-ready")).toBe(1);

    view.unmount();

    expect(fakeSocket.listenerCount("meeting:notes-ready")).toBe(0);
    expect(fakeSocket.listenerCount("meeting:deleted")).toBe(0);
  });
});

describe("WorkspaceMeetingsPanel: search", () => {
  const hit = (snippet: string) => ({
    meetingId: "m-1",
    meetingTitle: "Launch sync",
    meetingStartedAt: "2026-11-01T09:00:00.000Z",
    segmentId: "s-2",
    seq: 2,
    speakerName: "Grace Hopper",
    startMs: 130_000,
    snippet,
  });

  beforeEach(() => {
    server.use(
      http.get(MEETINGS, () =>
        ok({ meetings: [meetingRow()], nextCursor: null }),
      ),
    );
  });

  it("searches on submit and sends the query and workspace", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${MEETINGS}/search`, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return ok({ hits: [hit("ship the <mark>launch</mark> on Friday")] });
      }),
    );
    renderPanel();
    const user = userEvent.setup();

    await user.type(
      await screen.findByRole("searchbox", { name: "Search transcripts" }),
      "launch{Enter}",
    );

    const results = await screen.findByTestId("meeting-search-results");
    expect(results).toHaveTextContent('1 match for "launch"');
    expect(results).toHaveTextContent("Launch sync");
    expect(results).toHaveTextContent("Grace Hopper at 2:10");
    expect(queries[0]!.get("q")).toBe("launch");
    expect(queries[0]!.get("workspaceId")).toBe(WS);
    expect(screen.queryByTestId("meeting-row-m-1")).not.toBeInTheDocument();
  });

  it("renders only the mark tags as highlights and everything else as text", async () => {
    server.use(
      http.get(`${MEETINGS}/search`, () =>
        ok({
          hits: [
            hit(
              '<img src=x onerror="alert(1)"> then <mark>launch</mark> <script>bad()</script> <b>bold</b>',
            ),
          ],
        }),
      ),
    );
    renderPanel();
    const user = userEvent.setup();

    await user.type(
      await screen.findByRole("searchbox", { name: "Search transcripts" }),
      "launch{Enter}",
    );

    const results = await screen.findByTestId("meeting-search-results");
    const marks = results.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("launch");
    expect(results.querySelector("img")).toBeNull();
    expect(results.querySelector("script")).toBeNull();
    expect(results.querySelector("b")).toBeNull();
    expect(results).toHaveTextContent("<img src=x");
    expect(results).toHaveTextContent("<script>bad()</script>");
  });

  it("says when nothing matches and clears back to the list", async () => {
    server.use(http.get(`${MEETINGS}/search`, () => ok({ hits: [] })));
    renderPanel();
    const user = userEvent.setup();

    await user.type(
      await screen.findByRole("searchbox", { name: "Search transcripts" }),
      "zebra{Enter}",
    );

    expect(
      await screen.findByText('No transcript mentions "zebra".'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByTestId("meeting-row-m-1")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("shows the server's reason when a search fails", async () => {
    server.use(
      http.get(`${MEETINGS}/search`, () => fail(500, "Search is down")),
    );
    renderPanel();
    const user = userEvent.setup();

    await user.type(
      await screen.findByRole("searchbox", { name: "Search transcripts" }),
      "launch{Enter}",
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Search is down",
    );
  });

  it("does not search for blank text and returns to the list when emptied", async () => {
    let searches = 0;
    server.use(
      http.get(`${MEETINGS}/search`, () => {
        searches += 1;
        return ok({ hits: [hit("a <mark>b</mark>")] });
      }),
    );
    renderPanel();
    const user = userEvent.setup();
    const box = await screen.findByRole("searchbox", {
      name: "Search transcripts",
    });

    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
    await user.type(box, "  {Enter}");
    expect(searches).toBe(0);

    await user.clear(box);
    await user.type(box, "b{Enter}");
    await screen.findByTestId("meeting-search-results");
    await user.clear(box);
    expect(
      screen.queryByTestId("meeting-search-results"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("meeting-row-m-1")).toBeInTheDocument();
  });

  it("opens the meeting at the matching line when a hit is chosen", async () => {
    useMeetingRoutes();
    server.use(
      http.get(`${MEETINGS}/search`, () =>
        ok({ hits: [hit("shall we <mark>start</mark>")] }),
      ),
    );
    renderPanel();
    const user = userEvent.setup();

    await user.type(
      await screen.findByRole("searchbox", { name: "Search transcripts" }),
      "start{Enter}",
    );
    await user.click(await screen.findByTestId("search-hit-s-2"));

    const lines = await screen.findByTestId("transcript-lines");
    const marked = lines.querySelector('[aria-current="true"]');
    expect(marked).toHaveTextContent("Shall we start");
    expect(lines.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  });
});

describe("WorkspaceMeetingsPanel: views", () => {
  it("opens a meeting's detail from the list and returns with Back", async () => {
    useMeetingRoutes();
    server.use(
      http.get(MEETINGS, () =>
        ok({ meetings: [meetingRow()], nextCursor: null }),
      ),
    );
    renderPanel();
    const user = userEvent.setup();

    await user.click(
      await screen.findByText("Untitled meeting", { exact: false }),
    );
    expect(await screen.findByTestId("meeting-detail")).toHaveTextContent(
      "The team agreed to ship on Friday.",
    );

    await user.click(screen.getByRole("button", { name: /Back to meetings/ }));
    expect(await screen.findByTestId("meeting-row-m-1")).toBeInTheDocument();
  });

  it("switches to the action items view and back", async () => {
    server.use(
      http.get(MEETINGS, () =>
        ok({ meetings: [meetingRow()], nextCursor: null }),
      ),
      http.get(`${BACKEND_URL}/api/action-items`, () =>
        ok({ items: [actionItem()], nextCursor: null }),
      ),
    );
    renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId("meeting-row-m-1");
    expect(screen.getByRole("button", { name: "Meetings" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Action items" }));
    expect(await screen.findByTestId("action-item-a-1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Action items" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Meetings" }));
    expect(screen.getByTestId("meeting-row-m-1")).toBeInTheDocument();
  });

  it("returns to the list with a notice when the open meeting is deleted elsewhere", async () => {
    useMeetingRoutes();
    server.use(
      http.get(MEETINGS, () =>
        ok({ meetings: [meetingRow()], nextCursor: null }),
      ),
    );
    renderPanel();
    const user = userEvent.setup();
    await user.click(
      await screen
        .findByTestId("meeting-row-m-1")
        .then((row) => within(row).getByRole("button")),
    );
    await screen.findByTestId("meeting-detail");

    act(() => fakeSocket.fire("meeting:deleted", { meetingId: "m-1" }));

    await waitFor(() =>
      expect(screen.queryByTestId("meeting-detail")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("meetings-notice")).toHaveTextContent(
      "That meeting was deleted.",
    );
    expect(screen.queryByTestId("meeting-row-m-1")).not.toBeInTheDocument();
  });

  it("ignores the deletion of a different meeting", async () => {
    useMeetingRoutes();
    server.use(
      http.get(MEETINGS, () =>
        ok({ meetings: [meetingRow()], nextCursor: null }),
      ),
    );
    renderPanel();
    const user = userEvent.setup();
    await user.click(
      await screen
        .findByTestId("meeting-row-m-1")
        .then((row) => within(row).getByRole("button")),
    );
    await screen.findByTestId("meeting-detail");

    act(() => fakeSocket.fire("meeting:deleted", { meetingId: "m-9" }));

    expect(screen.getByTestId("meeting-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("meetings-notice")).not.toBeInTheDocument();
  });
});
