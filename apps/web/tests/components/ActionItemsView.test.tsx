/**
 * @module web/tests/components/ActionItemsView
 * @description The Meetings tab's action items view: the mine, open and all
 * filters and what each asks the API for, checking an item off, reassigning its
 * owner through the member select, setting and clearing a due date, cursor
 * paging, failures, and live updates from `meeting:action-items`.
 */
import "./testUtils";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActionItemsView from "../../components/meetings/ActionItemsView";
import { BACKEND_URL, fail, ok } from "../msw/handlers";
import { actionItem, members, WS } from "../msw/meetingFixtures";
import { server } from "../msw/server";
import { fakeSocket } from "./fakeSocket";
import { preflight } from "./testUtils";

vi.mock(
  "../../lib/socket",
  async () => (await import("./fakeSocket")).socketModule,
);

const ITEMS = `${BACKEND_URL}/api/action-items`;

function renderView(onOpenMeeting = vi.fn()) {
  render(
    <ActionItemsView
      workspaceId={WS}
      members={members}
      onOpenMeeting={onOpenMeeting}
    />,
  );
  return { onOpenMeeting };
}

beforeEach(() => {
  fakeSocket.reset();
  server.resetHandlers();
  server.use(preflight);
});

describe("ActionItemsView: filters", () => {
  it("starts on the viewer's own open items and switches filters", async () => {
    const queries: string[] = [];
    server.use(
      http.get(ITEMS, ({ request }) => {
        queries.push(new URL(request.url).search);
        return ok({ items: [actionItem()], nextCursor: null });
      }),
    );
    renderView();
    const user = userEvent.setup();

    await screen.findByTestId("action-item-a-1");
    expect(queries[0]).toContain("status=open");
    expect(queries[0]).toContain("owner=me");
    expect(queries[0]).toContain(`workspaceId=${WS}`);
    expect(screen.getByRole("button", { name: "Mine" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(queries).toHaveLength(2));
    expect(queries[1]).toContain("status=open");
    expect(queries[1]).not.toContain("owner=me");

    await user.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(queries).toHaveLength(3));
    expect(queries[2]).toContain("status=all");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Mine" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("says what an empty filter means", async () => {
    server.use(http.get(ITEMS, () => ok({ items: [], nextCursor: null })));
    renderView();
    const user = userEvent.setup();

    expect(await screen.findByTestId("action-items-empty")).toHaveTextContent(
      "Nothing is assigned to you.",
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() =>
      expect(screen.getByTestId("action-items-empty")).toHaveTextContent(
        "No open action items.",
      ),
    );
    await user.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() =>
      expect(screen.getByTestId("action-items-empty")).toHaveTextContent(
        "No action items yet.",
      ),
    );
  });

  it("shows why the list could not be read", async () => {
    server.use(http.get(ITEMS, () => fail(403, "Not a member")));
    renderView();

    expect(await screen.findByTestId("action-items-error")).toHaveTextContent(
      "Not a member",
    );
  });

  it("opens an item's meeting", async () => {
    server.use(
      http.get(ITEMS, () => ok({ items: [actionItem()], nextCursor: null })),
    );
    const { onOpenMeeting } = renderView();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "From Launch sync" }),
    );

    expect(onOpenMeeting).toHaveBeenCalledWith("m-1");
  });

  it("offers no meeting link once the meeting is gone", async () => {
    server.use(
      http.get(ITEMS, () =>
        ok({
          items: [actionItem({ meetingId: null, meetingTitle: null })],
          nextCursor: null,
        }),
      ),
    );
    renderView();

    await screen.findByTestId("action-item-a-1");
    expect(screen.queryByRole("button", { name: /^From/ })).toBeNull();
  });
});

describe("ActionItemsView: paging", () => {
  it("pages with the server's cursor and goes back", async () => {
    const cursors: Array<string | null> = [];
    server.use(
      http.get(ITEMS, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return cursor
          ? ok({
              items: [actionItem({ id: "a-old", text: "Old task" })],
              nextCursor: null,
            })
          : ok({ items: [actionItem()], nextCursor: "a-1" });
      }),
    );
    renderView();
    const user = userEvent.setup();

    await screen.findByTestId("action-item-a-1");
    await user.click(screen.getByTestId("action-items-pagination-next"));
    await screen.findByTestId("action-item-a-old");
    expect(cursors).toEqual([null, "a-1"]);

    await user.click(screen.getByTestId("action-items-pagination-previous"));
    await screen.findByTestId("action-item-a-1");
    expect(
      screen.getByTestId("action-items-pagination-page"),
    ).toHaveTextContent("Page 1");
  });
});

describe("ActionItemsView: editing", () => {
  beforeEach(() => {
    server.use(
      http.get(ITEMS, () => ok({ items: [actionItem()], nextCursor: null })),
    );
  });

  it("checks an item off and back on", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${ITEMS}/a-1`, async ({ request }) => {
        const body = (await request.json()) as { status: "OPEN" | "DONE" };
        bodies.push(body);
        return ok(actionItem({ status: body.status }));
      }),
    );
    renderView();
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

    await user.click(
      screen.getByRole("checkbox", {
        name: 'Mark "Send the launch checklist" not done',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("action-item-a-1")).toHaveAttribute(
        "data-status",
        "OPEN",
      ),
    );
    expect(bodies).toEqual([{ status: "DONE" }, { status: "OPEN" }]);
  });

  it("reassigns the owner from the workspace's members", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${ITEMS}/a-1`, async ({ request }) => {
        const body = (await request.json()) as { ownerUserId: string | null };
        bodies.push(body);
        return ok(
          actionItem({
            ownerUserId: body.ownerUserId,
            ownerName: body.ownerUserId ? "Alan Turing" : null,
          }),
        );
      }),
    );
    renderView();
    const user = userEvent.setup();

    const owner = await screen.findByTestId("owner-a-1");
    expect(owner).toHaveTextContent("Grace Hopper");
    await user.click(owner);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "Unassigned",
      "Ada Lovelace",
      "Grace Hopper",
      "Alan Turing",
    ]);
    await user.click(screen.getByRole("option", { name: "Alan Turing" }));
    await waitFor(() =>
      expect(screen.getByTestId("owner-a-1")).toHaveTextContent("Alan Turing"),
    );

    await user.click(screen.getByTestId("owner-a-1"));
    await user.click(screen.getByRole("option", { name: "Unassigned" }));
    await waitFor(() =>
      expect(screen.getByTestId("owner-a-1")).toHaveTextContent("Unassigned"),
    );
    expect(bodies).toEqual([{ ownerUserId: "user-3" }, { ownerUserId: null }]);
  });

  it("sets and clears the due date", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${ITEMS}/a-1`, async ({ request }) => {
        const body = (await request.json()) as { dueDate: string | null };
        bodies.push(body);
        return ok(actionItem({ dueDate: body.dueDate }));
      }),
    );
    renderView();
    const user = userEvent.setup();

    const due = await screen.findByLabelText("Due date");
    fireEvent.change(due, { target: { value: "2099-03-04" } });
    await waitFor(() => expect(due).toHaveValue("2099-03-04"));

    await user.click(
      screen.getByRole("button", {
        name: 'Clear due date for "Send the launch checklist"',
      }),
    );
    await waitFor(() => expect(due).toHaveValue(""));
    expect(bodies).toEqual([{ dueDate: "2099-03-04" }, { dueDate: null }]);
    expect(
      screen.queryByRole("button", { name: /Clear due date/ }),
    ).not.toBeInTheDocument();
  });

  it("flags an overdue item that is still open", async () => {
    server.use(
      http.get(ITEMS, () =>
        ok({
          items: [
            actionItem({ dueDate: "2020-01-01" }),
            actionItem({ id: "a-2", dueDate: "2020-01-01", status: "DONE" }),
          ],
          nextCursor: null,
        }),
      ),
    );
    renderView();

    const open = await screen.findByTestId("action-item-a-1");
    expect(open).toHaveTextContent("Overdue");
    expect(screen.getByTestId("action-item-a-2")).not.toHaveTextContent(
      "Overdue",
    );
  });

  it("notes a spoken owner who matched no member", async () => {
    server.use(
      http.get(ITEMS, () =>
        ok({
          items: [actionItem({ ownerUserId: null, ownerName: "Bob" })],
          nextCursor: null,
        }),
      ),
    );
    renderView();

    expect(await screen.findByText("Said: Bob")).toBeInTheDocument();
    expect(screen.getByTestId("owner-a-1")).toHaveTextContent("Unassigned");
  });

  it("shows a failed save and keeps the item as it was", async () => {
    server.use(
      http.patch(`${ITEMS}/a-1`, () => fail(404, "Action item not found")),
    );
    renderView();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("checkbox", {
        name: 'Mark "Send the launch checklist" done',
      }),
    );

    expect(await screen.findByTestId("action-items-error")).toHaveTextContent(
      "Action item not found",
    );
    expect(screen.getByTestId("action-item-a-1")).toHaveAttribute(
      "data-status",
      "OPEN",
    );
  });
});

describe("ActionItemsView: live updates", () => {
  it("updates a visible item in place without reloading", async () => {
    let loads = 0;
    server.use(
      http.get(ITEMS, () => {
        loads += 1;
        return ok({ items: [actionItem()], nextCursor: null });
      }),
    );
    renderView();
    await screen.findByTestId("action-item-a-1");

    act(() =>
      fakeSocket.fire("meeting:action-items", {
        meetingId: "m-1",
        items: [actionItem({ text: "Send the final checklist" })],
        removedIds: [],
      }),
    );

    expect(screen.getByTestId("action-item-a-1")).toHaveTextContent(
      "Send the final checklist",
    );
    expect(loads).toBe(1);
  });

  it("removes items the server says are gone", async () => {
    server.use(
      http.get(ITEMS, () =>
        ok({
          items: [actionItem(), actionItem({ id: "a-2", text: "Second" })],
          nextCursor: null,
        }),
      ),
    );
    renderView();
    await screen.findByTestId("action-item-a-2");

    act(() =>
      fakeSocket.fire("meeting:action-items", {
        meetingId: "m-1",
        items: [actionItem()],
        removedIds: [],
      }),
    );
    expect(screen.queryByTestId("action-item-a-2")).not.toBeInTheDocument();

    act(() =>
      fakeSocket.fire("meeting:action-items", {
        meetingId: null,
        items: [],
        removedIds: ["a-1"],
      }),
    );
    expect(screen.queryByTestId("action-item-a-1")).not.toBeInTheDocument();
  });

  it("merges a single changed item whose meeting is gone", async () => {
    server.use(
      http.get(ITEMS, () =>
        ok({
          items: [
            actionItem({ meetingId: null, meetingTitle: null }),
            actionItem({ id: "a-2", text: "Other meeting" }),
          ],
          nextCursor: null,
        }),
      ),
    );
    renderView();
    await screen.findByTestId("action-item-a-1");

    act(() =>
      fakeSocket.fire("meeting:action-items", {
        meetingId: null,
        items: [
          actionItem({
            meetingId: null,
            meetingTitle: null,
            status: "DONE",
          }),
        ],
        removedIds: [],
      }),
    );

    expect(screen.getByTestId("action-item-a-1")).toHaveAttribute(
      "data-status",
      "DONE",
    );
    expect(screen.getByTestId("action-item-a-2")).toBeInTheDocument();
  });

  it("reloads the page when an item it does not hold appears", async () => {
    let loads = 0;
    server.use(
      http.get(ITEMS, () => {
        loads += 1;
        return ok({
          items:
            loads === 1
              ? [actionItem()]
              : [actionItem(), actionItem({ id: "a-new", text: "Fresh" })],
          nextCursor: null,
        });
      }),
    );
    renderView();
    await screen.findByTestId("action-item-a-1");

    act(() =>
      fakeSocket.fire("meeting:action-items", {
        meetingId: "m-2",
        items: [actionItem({ id: "a-new", meetingId: "m-2", text: "Fresh" })],
        removedIds: [],
      }),
    );

    expect(await screen.findByTestId("action-item-a-new")).toBeInTheDocument();
    expect(loads).toBe(2);
  });

  it("stops listening when it unmounts", async () => {
    server.use(http.get(ITEMS, () => ok({ items: [], nextCursor: null })));
    renderView();
    await screen.findByTestId("action-items-empty");
    expect(fakeSocket.listenerCount("meeting:action-items")).toBe(1);
  });
});
