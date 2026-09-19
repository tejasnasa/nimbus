/**
 * @module web/tests/components/ViewWorkspaces
 * @description Dashboard grid behaviour: the "New Workspace" card always leads,
 * every workspace renders by default, and the "My Workspaces" toggle narrows the
 * grid to the ones the current user owns (OWNER role), not just belongs to.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "@nimbus/types";
import ViewWorkspaces from "../../components/ViewWorkspaces";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/home",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

const workspace = (
  id: string,
  name: string,
  members: Workspace["members"],
): Workspace => ({
  id,
  name,
  description: `${name} description`,
  slug: name.toLowerCase(),
  slugId: Number(id.replace(/\D/g, "")) || 1,
  inviteCode: `${name}-invite`,
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  members,
});

const workspaces: Workspace[] = [
  workspace("ws-1", "Alpha", [
    { id: "user-1", name: "Ada Lovelace", image: null, role: "OWNER" },
  ]),
  workspace("ws-2", "Beta", [
    { id: "user-1", name: "Ada Lovelace", image: null, role: "MEMBER" },
    { id: "user-9", name: "Someone Else", image: null, role: "OWNER" },
  ]),
  workspace("ws-3", "Gamma", []),
];

function renderGrid() {
  return render(
    <ViewWorkspaces
      workspaces={workspaces}
      id="user-1"
      deleteWorkspace={vi.fn()}
    />,
  );
}

describe("ViewWorkspaces", () => {
  it("leads with the create-workspace affordance and lists every workspace", () => {
    renderGrid();

    expect(
      screen.getByRole("heading", { name: "New Workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Beta/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Gamma/ })).toBeInTheDocument();
  });

  it("narrows to owned workspaces when 'My Workspaces' is selected", async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.click(screen.getByRole("button", { name: "My Workspaces" }));

    expect(screen.getByRole("link", { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Beta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Gamma/ })).not.toBeInTheDocument();
  });

  it("does not count membership alone as ownership", async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.click(screen.getByRole("button", { name: "My Workspaces" }));

    expect(screen.queryByRole("link", { name: /Beta/ })).not.toBeInTheDocument();
  });

  it("restores the full grid when switching back", async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.click(screen.getByRole("button", { name: "My Workspaces" }));
    await user.click(screen.getByRole("button", { name: "All Workspaces" }));

    expect(screen.getByRole("link", { name: /Beta/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Gamma/ })).toBeInTheDocument();
  });

  it("keeps the create card visible under the filtered view", async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.click(screen.getByRole("button", { name: "My Workspaces" }));

    expect(
      screen.getByRole("heading", { name: "New Workspace" }),
    ).toBeInTheDocument();
  });
});
