/**
 * @module web/tests/components/AccountSettings
 * @description Tab-shell behaviour for the `/settings` page: the four tabs
 * (Profile, Password, Sessions, Danger Zone) render in that order, the
 * Profile panel is visible by default, and clicking another label swaps to
 * its panel. Inactive panels are unmounted by `SettingTabs` (a documented
 * design property, not a bug), so their content does not appear in the DOM.
 *
 * The Profile-panel checks cover the form's own contract: it renders the
 * user's current values and gates the Save button on `isDirty`. The
 * Password-panel check verifies the change-password form renders for a
 * credential user (the default MSW handler returns a `credential` account),
 * and the Google-only check exercises the same hook with a `google`-only
 * list so the "Send me a set-password link" affordance appears instead.
 */
import "./testUtils";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../msw/server";
import AccountSettings from "../../components/AccountSettings";
import { preflight, BACKEND_URL } from "./testUtils";

const { routerMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

const USER = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.test",
  image: "https://cdn.example.com/ada.png",
};

/**
 * Overrides `/list-accounts` for the duration of one test. Tests that
 * need a non-default account list (Google-only) override the default
 * credential account handler here.
 */
const listAccountsHandler = (
  accounts: Array<{ providerId: string; id: string }>,
) =>
  http.get(`${BACKEND_URL}/api/auth/list-accounts`, () =>
    HttpResponse.json(accounts),
  );

beforeEach(() => {
  routerMock.refresh.mockClear();
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
  // The Password tab probes `/list-accounts` through the auth client;
  // that crosses origins in happy-dom, so the OPTIONS preflight must be
  // answered.
  server.use(preflight);
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

    expect(screen.getByLabelText("profile-settings-form")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("change-password-form"),
    ).not.toBeInTheDocument();
  });

  it("swaps to the Password panel when its tab is clicked", async () => {
    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);

    await user.click(screen.getByRole("button", { name: "Password" }));

    expect(screen.getByLabelText("change-password-form")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("profile-settings-form"),
    ).not.toBeInTheDocument();
  });

  it("swaps to the Sessions panel when its tab is clicked", async () => {
    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);

    await user.click(screen.getByRole("button", { name: "Sessions" }));

    expect(
      screen.getByText(/Devices currently signed in to your account/i),
    ).toBeInTheDocument();
  });

  it("swaps to the Danger Zone panel when its tab is clicked", async () => {
    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);

    await user.click(screen.getByRole("button", { name: "Danger Zone" }));

    expect(
      screen.getByText(/Irreversible actions on your account/i),
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

describe("AccountSettings Password tab", () => {
  it("renders the change-password form for a credential user", async () => {
    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);

    await user.click(screen.getByRole("button", { name: "Password" }));

    await waitFor(() =>
      expect(screen.getByLabelText("change-password-form")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/Current password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^New password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm new password/i)).toBeInTheDocument();
  });

  it("renders the set-password link affordance for a Google-only user", async () => {
    // Override the default /list-accounts response so the hook picks the
    // Google-only branch.
    server.use(listAccountsHandler([{ providerId: "google", id: "g-1" }]));

    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);

    await user.click(screen.getByRole("button", { name: "Password" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Send me a set-password link/i }),
      ).toBeInTheDocument(),
    );
    // The credential form is not present — pins the branching.
    expect(
      screen.queryByLabelText("change-password-form"),
    ).not.toBeInTheDocument();
  });

  it("shows a loading placeholder while /list-accounts is in flight", async () => {
    // Block /list-accounts indefinitely by overriding it with a handler
    // that never responds. happy-dom's fetch resolves immediately on
    // 304/no-content, so we use a never-resolving Promise instead.
    server.use(
      http.get(
        `${BACKEND_URL}/api/auth/list-accounts`,
        () => new Promise(() => {}),
      ),
    );

    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);

    await user.click(screen.getByRole("button", { name: "Password" }));

    expect(
      screen.getByText(/Checking your sign-in methods/i),
    ).toBeInTheDocument();
  });
});
