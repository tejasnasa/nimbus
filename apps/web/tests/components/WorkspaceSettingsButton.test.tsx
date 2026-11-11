/**
 * @module web/tests/components/WorkspaceSettingsButton
 * @description The sidebar gear: the settings modal stays closed until the
 * gear is used, then opens on the workspace it was given.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "@nimbus/types";
import WorkspaceSettingsButton from "../../components/WorkspaceSettingsButton";
import { WorkspaceSettingsProvider } from "../../components/WorkspaceSettingsContext";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/workspace/1",
  useParams: () => ({ slugId: "1" }),
  useSearchParams: () => new URLSearchParams(),
}));

const workspace: Workspace = {
  id: "cm_workspace_0000000000000",
  name: "Design Guild",
  description: "Shared drafts",
  slug: "design-guild",
  slugId: 1,
  inviteCode: "invite-code",
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  members: [{ id: "user-1", name: "Ada Lovelace", image: null, role: "OWNER" }],
};

function renderButton() {
  return render(
    <DocEditorRefProvider>
      <WorkspaceSettingsProvider workspace={workspace} documents={[]}>
        <WorkspaceSettingsButton />
      </WorkspaceSettingsProvider>
    </DocEditorRefProvider>,
  );
}

describe("WorkspaceSettingsButton", () => {
  it("keeps the settings modal closed until the gear is used", () => {
    renderButton();

    expect(
      screen.queryByRole("heading", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });

  it("opens the workspace settings modal from the gear", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(
      screen.getByRole("button", { name: "Workspace settings" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Design Guild")).toBeInTheDocument();
  });
});
