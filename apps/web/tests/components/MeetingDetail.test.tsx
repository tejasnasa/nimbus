/**
 * @module web/tests/components/MeetingDetail
 * @description One meeting inside the Meetings tab: the notes it renders (and
 * what it says while they are being written or after they failed), its
 * transcript with colours, timestamps and the caption language, live captions
 * and refreshed notes over the socket, opening the notes document, drawing the
 * discussion, and deleting with its confirmation, permissions and refusals.
 */
import "./testUtils";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientDocument } from "../../api/document";
import {
  DocEditorRefProvider,
  useDocEditorRef,
} from "../../components/DocEditorRefContext";
import MeetingDetail from "../../components/meetings/MeetingDetail";
import { prefsKey } from "../../hooks/useCaptionPrefs";
import { BACKEND_URL, fail, ok } from "../msw/handlers";
import {
  actionItem,
  meetingDetail,
  members,
  segment,
} from "../msw/meetingFixtures";
import { server } from "../msw/server";
import { fakeSocket } from "./fakeSocket";
import { preflight } from "./testUtils";

vi.mock(
  "../../lib/socket",
  async () => (await import("./fakeSocket")).socketModule,
);

const MEETING = `${BACKEND_URL}/api/meetings/m-1`;

const settings = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock("../../components/WorkspaceSettingsContext", () => ({
  useOptionalWorkspaceSettings: () => ({
    open: vi.fn(),
    close: settings.close,
  }),
}));

/** Registers the add-tab bridge so a test can see which document was opened. */
function AddTabProbe({ onAdd }: { onAdd: (doc: ClientDocument) => void }) {
  const ref = useDocEditorRef();
  ref.current = onAdd;
  return null;
}

function renderDetail(
  props: Partial<Parameters<typeof MeetingDetail>[0]> = {},
  onAdd: (doc: ClientDocument) => void = () => {},
) {
  const onBack = vi.fn();
  const onDeleted = vi.fn();
  render(
    <DocEditorRefProvider>
      <AddTabProbe onAdd={onAdd} />
      <MeetingDetail
        meetingId="m-1"
        members={members}
        userId="user-3"
        isAdmin={false}
        onBack={onBack}
        onDeleted={onDeleted}
        {...props}
      />
    </DocEditorRefProvider>,
  );
  return { onBack, onDeleted };
}

function routes(
  detail = meetingDetail(),
  segments = [segment(1, "Hello there"), segment(2, "Shall we start")],
) {
  server.use(
    http.get(MEETING, () => ok(detail)),
    http.get(`${MEETING}/segments`, () => ok({ segments, hasMore: false })),
  );
}

beforeEach(() => {
  fakeSocket.reset();
  settings.close.mockClear();
  window.localStorage.clear();
  server.resetHandlers();
  server.use(preflight);
});

describe("MeetingDetail: the notes", () => {
  it("renders the summary, decisions, open questions, topics and participants", async () => {
    routes();
    renderDetail();

    const detail = await screen.findByTestId("meeting-detail");
    await waitFor(() =>
      expect(detail).toHaveTextContent("The team agreed to ship on Friday."),
    );
    expect(detail).toHaveTextContent("Launch sync");
    expect(screen.getByTestId("meeting-status")).toHaveTextContent(
      "Notes ready",
    );
    expect(detail).toHaveTextContent("Ship on Friday");
    expect(detail).toHaveTextContent("Who owns the changelog?");
    expect(detail).toHaveTextContent("Docs");
    expect(screen.getByTestId("meeting-participants")).toHaveTextContent(
      "With Ada Lovelace, Grace Hopper",
    );
    expect(screen.getByTestId("action-item-a-1")).toHaveTextContent(
      "Send the launch checklist",
    );
  });

  it("shows the transcript with timestamps and a colour per speaker", async () => {
    routes(meetingDetail(), [
      segment(1, "Hello there"),
      segment(2, "Hi", {
        speakerName: "Grace Hopper",
        speakerUserId: "user-2",
      }),
      segment(3, "Again", { speakerName: "Ada Lovelace" }),
    ]);
    renderDetail();

    const lines = await screen.findByTestId("transcript-lines");
    expect(lines).toHaveTextContent("1:05");
    expect(lines).toHaveTextContent("Ada Lovelace: Hello there");
    const names = within(lines).getAllByText(/:$/, {
      selector: "span.font-semibold",
    });
    expect(names[0]!.style.color).toBe(names[2]!.style.color);
    expect(names[0]!.style.color).not.toBe(names[1]!.style.color);
  });

  it("says the notes are being written for an ended meeting", async () => {
    routes(
      meetingDetail({
        status: "ENDED",
        summary: null,
        notesDocumentId: null,
        actionItems: [],
        decisions: [],
        title: null,
      }),
    );
    renderDetail();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "NimbusBot is writing the notes",
    );
    expect(screen.getByTestId("meeting-status")).toHaveTextContent(
      "Writing notes…",
    );
    expect(screen.queryByTestId("open-notes")).not.toBeInTheDocument();
  });

  it("explains a failure and keeps the transcript", async () => {
    routes(
      meetingDetail({
        status: "FAILED",
        summary: null,
        notesDocumentId: null,
        actionItems: [],
        decisions: [],
        failureReason: "The model returned notes that could not be read.",
      }),
    );
    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The model returned notes that could not be read.",
    );
    expect(await screen.findByTestId("transcript-lines")).toBeInTheDocument();
  });

  it("shows why the meeting could not be read", async () => {
    server.use(http.get(MEETING, () => fail(404, "Meeting not found")));
    server.use(
      http.get(`${MEETING}/segments`, () =>
        ok({ segments: [], hasMore: false }),
      ),
    );
    const { onBack } = renderDetail();
    const user = userEvent.setup();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Meeting not found",
    );
    await user.click(screen.getByRole("button", { name: /Back to meetings/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("reloads the notes when they become ready", async () => {
    let calls = 0;
    server.use(
      http.get(MEETING, () => {
        calls += 1;
        return ok(
          calls === 1
            ? meetingDetail({
                status: "ENDED",
                summary: null,
                notesDocumentId: null,
                actionItems: [],
                decisions: [],
              })
            : meetingDetail(),
        );
      }),
      http.get(`${MEETING}/segments`, () =>
        ok({ segments: [], hasMore: false }),
      ),
    );
    renderDetail();
    await screen.findByText(/NimbusBot is writing the notes/);

    act(() =>
      fakeSocket.fire("meeting:notes-ready", {
        meetingId: "m-1",
        documentId: "doc-notes-1",
      }),
    );

    expect(
      await screen.findByText("The team agreed to ship on Friday."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("open-notes")).toBeInTheDocument();
  });

  it("ignores events about other meetings", async () => {
    let calls = 0;
    server.use(
      http.get(MEETING, () => {
        calls += 1;
        return ok(meetingDetail());
      }),
      http.get(`${MEETING}/segments`, () =>
        ok({ segments: [], hasMore: false }),
      ),
    );
    renderDetail();
    await screen.findByText("The team agreed to ship on Friday.");

    act(() => {
      fakeSocket.fire("meeting:notes-ready", {
        meetingId: "m-9",
        documentId: "d",
      });
      fakeSocket.fire("meeting:action-items", {
        meetingId: "m-9",
        items: [],
        removedIds: [],
      });
    });

    expect(calls).toBe(1);
    expect(screen.getByTestId("action-item-a-1")).toBeInTheDocument();
  });
});

describe("MeetingDetail: transcript", () => {
  it("opens in the viewer's caption language and the select overrides it", async () => {
    window.localStorage.setItem(
      prefsKey("user-3"),
      JSON.stringify({
        size: "m",
        highContrast: false,
        lines: 3,
        language: "fr",
      }),
    );
    const asked: Array<string | null> = [];
    server.use(
      http.get(MEETING, () => ok(meetingDetail())),
      http.get(`${MEETING}/segments`, ({ request }) => {
        const language = new URL(request.url).searchParams.get("language");
        asked.push(language);
        return ok({
          segments: [
            segment(1, "Hello there", {
              translation:
                language === "es" ? "Hola" : language ? "Bonjour" : null,
            }),
          ],
          hasMore: false,
        });
      }),
    );
    renderDetail();
    const user = userEvent.setup();

    expect(
      await screen.findByText("Bonjour", { exact: false }),
    ).toBeInTheDocument();
    // The first render has not read the stored preference yet, so a read in
    // the original is superseded by the one in French.
    expect(asked.at(-1)).toBe("fr");
    asked.length = 0;

    await user.click(screen.getByTestId("meeting-transcript-language"));
    await user.click(screen.getByRole("option", { name: /Spanish/ }));
    expect(
      await screen.findByText("Hola", { exact: false }),
    ).toBeInTheDocument();
    expect(asked).toEqual(["es"]);

    await user.click(screen.getByTestId("meeting-transcript-language"));
    await user.click(screen.getByRole("option", { name: /Original/ }));
    await waitFor(() => expect(asked).toEqual(["es", null]));
    expect(
      await screen.findByText("Hello there", { exact: false }),
    ).toBeInTheDocument();
  });

  it("offers a retry when the transcript fails", async () => {
    let hits = 0;
    server.use(
      http.get(MEETING, () => ok(meetingDetail())),
      http.get(`${MEETING}/segments`, () => {
        hits += 1;
        return hits === 1
          ? fail(500, "Transcript unavailable")
          : ok({ segments: [segment(1, "Back again")], hasMore: false });
      }),
    );
    renderDetail();
    const user = userEvent.setup();

    expect(
      await screen.findByText("Transcript unavailable"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(/Back again/)).toBeInTheDocument();
  });

  it("says when nothing was transcribed", async () => {
    routes(meetingDetail({ segmentCount: 0 }), []);
    renderDetail();

    expect(
      await screen.findByText("Nothing was transcribed in this meeting."),
    ).toBeInTheDocument();
  });

  it("reads a long transcript across pages", async () => {
    const afters: string[] = [];
    server.use(
      http.get(MEETING, () => ok(meetingDetail())),
      http.get(`${MEETING}/segments`, ({ request }) => {
        const after = new URL(request.url).searchParams.get("afterSeq")!;
        afters.push(after);
        return after === "0"
          ? ok({ segments: [segment(1, "one")], hasMore: true })
          : ok({ segments: [segment(2, "two")], hasMore: false });
      }),
    );
    renderDetail();

    const lines = await screen.findByTestId("transcript-lines");
    expect(lines).toHaveTextContent("one");
    expect(lines).toHaveTextContent("two");
    expect(afters).toEqual(["0", "1"]);
  });

  it("appends live captions to a live meeting once, in order", async () => {
    routes(
      meetingDetail({
        status: "LIVE",
        summary: null,
        notesDocumentId: null,
        endedAt: null,
      }),
      [segment(1, "Hello there")],
    );
    renderDetail();
    await screen.findByTestId("transcript-lines");

    act(() => {
      fakeSocket.fire("meeting:segment", {
        meetingId: "m-1",
        segment: segment(3, "Third"),
      });
      fakeSocket.fire("meeting:segment", {
        meetingId: "m-1",
        segment: segment(2, "Second"),
      });
      fakeSocket.fire("meeting:segment", {
        meetingId: "m-1",
        segment: segment(2, "Second"),
      });
      fakeSocket.fire("meeting:segment", {
        meetingId: "m-9",
        segment: segment(4, "Elsewhere"),
      });
    });

    const items = within(screen.getByTestId("transcript-lines")).getAllByRole(
      "listitem",
    );
    expect(items.map((li) => li.getAttribute("data-seq"))).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(screen.queryByText(/Elsewhere/)).not.toBeInTheDocument();
  });

  it("does not listen for captions once the meeting is over", async () => {
    routes();
    renderDetail();
    await screen.findByTestId("transcript-lines");

    expect(fakeSocket.listenerCount("meeting:segment")).toBe(0);
  });
});

describe("MeetingDetail: actions", () => {
  it("opens the notes document in the editor and closes the settings", async () => {
    routes();
    const opened: ClientDocument[] = [];
    server.use(
      http.get(`${BACKEND_URL}/api/document/doc-notes-1`, () =>
        ok({
          id: "doc-notes-1",
          title: "Meeting notes: Launch sync",
          type: "MARKDOWN",
          canvasData: null,
          yjsState: null,
        }),
      ),
    );
    renderDetail({}, (doc) => opened.push(doc));
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("open-notes"));

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toMatchObject({
      id: "doc-notes-1",
      label: "Meeting notes: Launch sync",
      type: "MARKDOWN",
    });
    expect(settings.close).toHaveBeenCalled();
  });

  it("says when the notes document cannot be opened", async () => {
    routes();
    server.use(
      http.get(`${BACKEND_URL}/api/document/doc-notes-1`, () =>
        fail(404, "Document not found"),
      ),
    );
    renderDetail();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("open-notes"));

    expect(
      await screen.findByText("That document could not be opened."),
    ).toBeInTheDocument();
    expect(settings.close).not.toHaveBeenCalled();
  });

  it("starts drawing the discussion and says where it will appear", async () => {
    routes();
    let posted = 0;
    server.use(
      http.post(`${MEETING}/diagram`, () => {
        posted += 1;
        return new Response(
          JSON.stringify({
            success: true,
            message: "Drawing the discussion",
            responseObject: { started: true, label: "Launch sync diagram" },
            statusCode: 202,
          }),
          { status: 202, headers: { "content-type": "application/json" } },
        );
      }),
    );
    renderDetail();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("draw-diagram"));

    expect(await screen.findByRole("status")).toHaveTextContent(
      'Drawing "Launch sync diagram"',
    );
    expect(posted).toBe(1);
  });

  it("disables drawing until the notes exist", async () => {
    routes(
      meetingDetail({
        status: "ENDED",
        summary: null,
        notesDocumentId: null,
        actionItems: [],
        decisions: [],
      }),
    );
    renderDetail();

    expect(await screen.findByTestId("draw-diagram")).toBeDisabled();
    expect(
      screen.getByText("Drawing is available once the notes are written."),
    ).toBeInTheDocument();
  });

  it("shows the server's reason when drawing is refused", async () => {
    routes();
    server.use(
      http.post(
        `${MEETING}/diagram`,
        () =>
          new Response(
            JSON.stringify({
              success: false,
              message: "Add an API key to draw diagrams.",
              responseObject: { reason: "no-key", cta: "add-key" },
              statusCode: 403,
            }),
            { status: 403, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    renderDetail();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("draw-diagram"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add an API key to draw diagrams.",
    );
    expect(screen.getByTestId("draw-diagram")).toBeEnabled();
  });
});

describe("MeetingDetail: deleting", () => {
  it("offers delete to an admin, confirms first and then reports back", async () => {
    routes();
    let deleted = 0;
    server.use(
      http.delete(MEETING, () => {
        deleted += 1;
        return ok({ meetingId: "m-1" });
      }),
    );
    const { onDeleted } = renderDetail({ isAdmin: true, userId: "user-2" });
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("delete-meeting"));
    expect(deleted).toBe(0);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("This cannot be undone");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(deleted).toBe(0);

    await user.click(screen.getByTestId("delete-meeting"));
    await user.click(await screen.findByTestId("confirm-delete-meeting"));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("m-1"));
    expect(deleted).toBe(1);
  });

  it("offers delete to whoever started the meeting", async () => {
    routes(meetingDetail({ startedById: "user-3" }));
    renderDetail({ isAdmin: false, userId: "user-3" });

    expect(await screen.findByTestId("delete-meeting")).toBeEnabled();
  });

  it("disables delete for other members and says why", async () => {
    routes();
    renderDetail({ isAdmin: false, userId: "user-3" });

    expect(await screen.findByTestId("delete-meeting")).toBeDisabled();
    expect(
      screen.getByText(
        "Only an admin or whoever started the meeting can delete it.",
      ),
    ).toBeInTheDocument();
  });

  it("disables delete while the meeting is live", async () => {
    routes(
      meetingDetail({
        status: "LIVE",
        endedAt: null,
        summary: null,
        notesDocumentId: null,
      }),
    );
    renderDetail({ isAdmin: true, userId: "user-1" });

    expect(await screen.findByTestId("delete-meeting")).toBeDisabled();
    expect(
      screen.getByText("End the meeting before deleting it."),
    ).toBeInTheDocument();
  });

  it("shows the server's refusal when the meeting went live meanwhile", async () => {
    routes();
    server.use(
      http.delete(MEETING, () =>
        fail(409, "End the meeting before deleting it"),
      ),
    );
    const { onDeleted } = renderDetail({ isAdmin: true, userId: "user-1" });
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("delete-meeting"));
    await user.click(await screen.findByTestId("confirm-delete-meeting"));

    expect(await screen.findByTestId("delete-error")).toHaveTextContent(
      "End the meeting before deleting it",
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe("MeetingDetail: action items", () => {
  it("replaces its action items when the meeting's set changes", async () => {
    routes();
    renderDetail();
    await screen.findByTestId("action-item-a-1");

    act(() =>
      fakeSocket.fire("meeting:action-items", {
        meetingId: "m-1",
        items: [actionItem({ id: "a-2", text: "Write the changelog" })],
        removedIds: [],
      }),
    );

    expect(screen.queryByTestId("action-item-a-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("action-item-a-2")).toHaveTextContent(
      "Write the changelog",
    );
  });

  it("checks an item off and shows what the server stored", async () => {
    routes();
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${BACKEND_URL}/api/action-items/a-1`, async ({ request }) => {
        bodies.push(await request.json());
        return ok(
          actionItem({
            status: "DONE",
            completedAt: "2026-11-02T10:00:00.000Z",
          }),
        );
      }),
    );
    renderDetail();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("checkbox", {
        name: 'Mark "Send the launch checklist" done',
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("action-item-a-1")).toHaveAttribute(
        "data-status",
        "DONE",
      ),
    );
    expect(bodies).toEqual([{ status: "DONE" }]);
  });

  it("shows a rejected change and leaves the item as it was", async () => {
    routes();
    server.use(
      http.patch(`${BACKEND_URL}/api/action-items/a-1`, () =>
        fail(400, "The owner must be a member of this workspace"),
      ),
    );
    renderDetail();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("checkbox", {
        name: 'Mark "Send the launch checklist" done',
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The owner must be a member of this workspace",
    );
    expect(screen.getByTestId("action-item-a-1")).toHaveAttribute(
      "data-status",
      "OPEN",
    );
  });
});
