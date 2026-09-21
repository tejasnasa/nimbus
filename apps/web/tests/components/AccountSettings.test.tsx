/**
 * @module web/tests/components/AccountSettings
 * @description Tab-shell behaviour for the `/settings` page: the four tabs
 * (Profile, Password, Sessions, Danger Zone) render in that order, the
 * Profile panel is visible by default, and clicking another label swaps to
 * its panel. Inactive panels are unmounted by `SettingTabs` (a documented
 * design property, not a bug), so their content does not appear in the DOM.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import AccountSettings from "../../components/AccountSettings";

beforeEach(() => {
  // Auth client is module-load side-effectful; default msw handlers satisfy it.
});

describe("AccountSettings", () => {
  it("renders the four account tabs in order", () => {
    render(<AccountSettings />);

    const tabs = screen.getAllByRole("button", {
      name: /Profile|Password|Sessions|Danger Zone/,
    });
    expect(tabs.map((b) => b.textContent)).toEqual([
      "Profile",
      "Password",
      "Sessions",
      "Danger Zone",
    ]);
  });

  it("shows the Profile panel by default", () => {
    render(<AccountSettings />);

    expect(screen.getByText(/Phase 5/)).toBeInTheDocument();
    expect(screen.queryByText(/Phase 6/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 7/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 8/)).not.toBeInTheDocument();
  });

  it("swaps to the Password panel when its tab is clicked", async () => {
    const user = userEvent.setup();
    render(<AccountSettings />);

    await user.click(screen.getByRole("button", { name: "Password" }));

    expect(screen.getByText(/Phase 6/)).toBeInTheDocument();
    expect(screen.queryByText(/Phase 5/)).not.toBeInTheDocument();
  });

  it("swaps to the Sessions panel when its tab is clicked", async () => {
    const user = userEvent.setup();
    render(<AccountSettings />);

    await user.click(screen.getByRole("button", { name: "Sessions" }));

    expect(screen.getByText(/Phase 7/)).toBeInTheDocument();
  });

  it("swaps to the Danger Zone panel when its tab is clicked", async () => {
    const user = userEvent.setup();
    render(<AccountSettings />);

    await user.click(screen.getByRole("button", { name: "Danger Zone" }));

    expect(screen.getByText(/Phase 8/)).toBeInTheDocument();
    expect(
      screen.getByText(/Permanently delete this account/),
    ).toBeInTheDocument();
  });
});
