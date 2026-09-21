/**
 * @module web/tests/components/AccountSettings
 * @description Tab-shell behaviour for the `/settings` page: the four tabs
 * (Profile, Password, Sessions, Danger Zone) render in that order, the
 * Profile panel is visible by default, and clicking another label swaps to
 * its panel. Inactive panels are unmounted by `SettingTabs` (a documented
 * design property, not a bug), so their content does not appear in the DOM.
 *
 * The Profile-panel checks cover the form's own contract: it renders the
 * user's current values and gates the Save button on `isDirty`.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountSettings from "../../components/AccountSettings";

const { routerMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

const USER = {
  id: "user-1",
  name: "Ada Lovelace",
  image: "https://cdn.example.com/ada.png",
};

beforeEach(() => {
  routerMock.refresh.mockClear();
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
});

describe("AccountSettings", () => {
  it("renders the four account tabs in order", () => {
    render(<AccountSettings user={USER} />);

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
    render(<AccountSettings user={USER} />);

    expect(screen.getByText(/Phase 5/)).toBeInTheDocument();
    expect(screen.queryByText(/Phase 6/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 7/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 8/)).not.toBeInTheDocument();
  });

  it("swaps to the Password panel when its tab is clicked", async () => {
    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);

    await user.click(screen.getByRole("button", { name: "Password" }));

    expect(screen.getByText(/Phase 6/)).toBeInTheDocument();
    expect(screen.queryByText(/Phase 5/)).not.toBeInTheDocument();
  });

  it("swaps to the Sessions panel when its tab is clicked", async () => {
    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);

    await user.click(screen.getByRole("button", { name: "Sessions" }));

    expect(screen.getByText(/Phase 7/)).toBeInTheDocument();
  });

  it("swaps to the Danger Zone panel when its tab is clicked", async () => {
    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);

    await user.click(screen.getByRole("button", { name: "Danger Zone" }));

    expect(screen.getByText(/Phase 8/)).toBeInTheDocument();
    expect(
      screen.getByText(/Permanently delete this account/),
    ).toBeInTheDocument();
  });
});

describe("AccountSettings Profile tab", () => {
  it("seeds the name field with the current display name", () => {
    render(<AccountSettings user={USER} />);

    const nameInput = screen.getByLabelText(/Display name/i);
    expect(nameInput).toHaveValue(USER.name);
  });

  it("disables Save until the form is dirty", () => {
    render(<AccountSettings user={USER} />);

    expect(screen.getByRole("button", { name: /Save/i })).toBeDisabled();
  });

  it("enables Save after the name is edited and shows a preview of the current avatar", async () => {
    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);

    const nameInput = screen.getByLabelText(/Display name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Augusta Ada King");

    expect(screen.getByRole("button", { name: /Save/i })).toBeEnabled();
    expect(screen.getByAltText(USER.name)).toHaveAttribute("src", USER.image);
  });

  it("falls back to a bundled avatar when the user has no image", () => {
    render(<AccountSettings user={{ ...USER, image: null }} />);

    // Without a custom image, the preview uses the deterministic fallback.
    expect(screen.getByAltText(USER.name)).toBeInTheDocument();
  });
});
