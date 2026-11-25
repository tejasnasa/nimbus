/**
 * @module web/tests/components/WorkspaceMembershipControls
 * @description The viewer's own membership controls in workspace settings: a
 * member leaves after confirming and lands on the dashboard; the owner gets no
 * Leave button, picks a new owner (never Nimbus) and confirms the transfer;
 * refusals are shown inline.
 */
import "./testUtils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Workspace } from "@nimbus/types";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceMembershipControls from "../../components/WorkspaceMembershipControls";
import { BACKEND_URL, fail } from "../msw/handlers";
import { server } from "../msw/server";
import { preflight } from "./testUtils";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
}));

const BOT = process.env.NEXT_PUBLIC_BOT_USERID ?? "bot-user";

const workspace: Workspace = {
  id: "cm_workspace_0000000000000",
  name: "Design Guild",
  description: "Shared drafts",
  slug: "design-guild",
  slugId: 1,
  inviteCode: "invite-code",
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  members: [
    { id: "user-1", name: "Ada Lovelace", image: null, role: "OWNER" },
    { id: "user-2", name: "Grace Hopper", image: null, role: "ADMIN" },
    { id: BOT, name: "Nimbus", image: null, role: "ADMIN" },
  ],
};

/** Captures requests to `method path`, returning their parsed bodies. */
function capture(method: "put" | "delete", path: string, response?: Response) {
  const bodies: unknown[] = [];
  server.use(
    http[method](`${BACKEND_URL}${path}`, async ({ request }) => {
      bodies.push(JSON.parse(await request.text()));
      return (
        response ?? HttpResponse.json({ success: true, responseObject: {} })
      );
    }),
  );
  return bodies;
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  server.resetHandlers();
  server.use(preflight);
  vi.stubEnv("NEXT_PUBLIC_BOT_USERID", BOT);
});

describe("WorkspaceMembershipControls: leaving", () => {
  it("leaves after confirming and returns to the dashboard", async () => {
    const user = userEvent.setup();
    const bodies = capture("delete", `/api/workspace/leave/${workspace.id}`);
    render(
      <WorkspaceMembershipControls workspace={workspace} userId="user-2" />,
    );

    await user.click(screen.getByRole("button", { name: "Leave Workspace" }));
    await user.click(await screen.findByRole("button", { name: "Leave" }));

    await waitFor(() => expect(bodies).toEqual([{ memberId: "user-2" }]));
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("shows why leaving was refused and stays put", async () => {
    const user = userEvent.setup();
    capture(
      "delete",
      `/api/workspace/leave/${workspace.id}`,
      fail(403, "Transfer ownership to another member before leaving"),
    );
    render(
      <WorkspaceMembershipControls workspace={workspace} userId="user-2" />,
    );

    await user.click(screen.getByRole("button", { name: "Leave Workspace" }));
    await user.click(await screen.findByRole("button", { name: "Leave" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transfer ownership to another member before leaving",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("renders nothing for someone who is not a member", () => {
    render(
      <WorkspaceMembershipControls workspace={workspace} userId="nobody" />,
    );

    expect(screen.queryByTestId("membership-controls")).not.toBeInTheDocument();
  });
});

describe("WorkspaceMembershipControls: transferring ownership", () => {
  it("offers the owner no Leave button and never Nimbus as a new owner", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceMembershipControls workspace={workspace} userId="user-1" />,
    );

    expect(
      screen.queryByRole("button", { name: "Leave Workspace" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Transfer ownership" }),
    ).toBeDisabled();

    await user.click(screen.getByTestId("new-owner"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose a member",
      "Grace Hopper",
    ]);
  });

  it("hands ownership to the chosen member after confirming", async () => {
    const user = userEvent.setup();
    const bodies = capture("put", `/api/workspace/transfer/${workspace.id}`);
    render(
      <WorkspaceMembershipControls workspace={workspace} userId="user-1" />,
    );

    await user.click(screen.getByTestId("new-owner"));
    await user.click(screen.getByRole("option", { name: "Grace Hopper" }));
    await user.click(
      screen.getByRole("button", { name: "Transfer ownership" }),
    );
    expect(
      await screen.findByText(/Make Grace Hopper the owner of Design Guild/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Transfer" }));

    await waitFor(() => expect(bodies).toEqual([{ memberId: "user-2" }]));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Ownership transferred. You are now an admin.",
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("says when there is nobody to hand ownership to", () => {
    render(
      <WorkspaceMembershipControls
        workspace={{
          ...workspace,
          members: workspace.members.filter((m) => m.id !== "user-2"),
        }}
        userId="user-1"
      />,
    );

    expect(screen.getByText(/nobody to hand ownership to/)).toBeInTheDocument();
  });
});
