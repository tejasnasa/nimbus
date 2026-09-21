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

    await waitFor(() =>
      expect(screen.getByLabelText("active-sessions")).toBeInTheDocument(),
    );
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

describe("AccountSettings Sessions tab", () => {
  const SESSIONS = [
    {
      token: "current-token",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ipAddress: "203.0.113.10",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
    {
      token: "other-token",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ipAddress: "203.0.113.20",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
      createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
  ];

  type SessionRow = Omit<(typeof SESSIONS)[number], "userAgent"> & {
    userAgent?: string | null;
  };

  const listSessionsHandler = (sessions: SessionRow[]) =>
    http.get(`${BACKEND_URL}/api/auth/list-sessions`, () =>
      HttpResponse.json(sessions),
    );

  const getSessionHandler = (token: string | null) =>
    http.get(`${BACKEND_URL}/api/auth/get-session`, () =>
      HttpResponse.json(
        token
          ? { session: { token }, user: { id: "user-1" } }
          : { session: null, user: null },
      ),
    );

  it("renders one row per session with a coarse browser/OS label", async () => {
    server.use(
      listSessionsHandler(SESSIONS),
      getSessionHandler("current-token"),
    );

    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);
    await user.click(screen.getByRole("button", { name: "Sessions" }));

    await waitFor(() =>
      expect(screen.getAllByTestId("session-row")).toHaveLength(2),
    );

    expect(screen.getByText("Chrome on macOS")).toBeInTheDocument();
    expect(screen.getByText("Firefox on Windows")).toBeInTheDocument();
  });

  it("labels the current session and disables its revoke control", async () => {
    server.use(
      listSessionsHandler(SESSIONS),
      getSessionHandler("current-token"),
    );

    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);
    await user.click(screen.getByRole("button", { name: "Sessions" }));

    await waitFor(() =>
      expect(screen.getAllByTestId("session-row")).toHaveLength(2),
    );

    const rows = screen.getAllByTestId("session-row");
    const currentRow = rows.find(
      (row) => row.getAttribute("data-current") === "true",
    );
    expect(currentRow).toBeDefined();
    expect(currentRow).toHaveTextContent("This device");

    const currentRevoke = currentRow?.querySelector("button");
    expect(currentRevoke).toBeDisabled();

    // The other row's revoke is enabled.
    const otherRow = rows.find(
      (row) => row.getAttribute("data-current") !== "true",
    );
    const otherRevoke = otherRow?.querySelector("button");
    expect(otherRevoke).toBeEnabled();
  });

  it("shows a bulk sign-out-of-other-devices affordance when more than one session exists", async () => {
    server.use(
      listSessionsHandler(SESSIONS),
      getSessionHandler("current-token"),
    );

    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);
    await user.click(screen.getByRole("button", { name: "Sessions" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: /Sign out of all other devices/i,
        }),
      ).toBeInTheDocument(),
    );
  });

  it("omits the bulk affordance when only the current session exists", async () => {
    server.use(
      listSessionsHandler([SESSIONS[0]!]),
      getSessionHandler("current-token"),
    );

    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);
    await user.click(screen.getByRole("button", { name: "Sessions" }));

    await waitFor(() =>
      expect(screen.getAllByTestId("session-row")).toHaveLength(1),
    );
    expect(
      screen.queryByRole("button", { name: /Sign out of all other devices/i }),
    ).not.toBeInTheDocument();
  });

  it("falls back to 'Unknown browser' when a row has no user agent", async () => {
    const [current] = SESSIONS;
    const row: SessionRow = { ...current!, userAgent: null };
    server.use(listSessionsHandler([row]), getSessionHandler("current-token"));

    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);
    await user.click(screen.getByRole("button", { name: "Sessions" }));

    await waitFor(() =>
      expect(screen.getByText("Unknown browser")).toBeInTheDocument(),
    );
  });

  it("shows the loading placeholder while /list-sessions is in flight", async () => {
    server.use(
      http.get(
        `${BACKEND_URL}/api/auth/list-sessions`,
        () => new Promise(() => {}),
      ),
      getSessionHandler("current-token"),
    );

    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);
    await user.click(screen.getByRole("button", { name: "Sessions" }));

    expect(
      screen.getByText(/Loading your active sessions/i),
    ).toBeInTheDocument();
  });

  // The hook's error path (authClient.listSessions rejection) is fully
  // covered in `tests/unit/hooks/useActiveSessions.test.tsx`. Triggering it
  // from this file would require swapping the auth client's
  // `customFetchImpl`, which is captured at module load — not worth the
  // harness for a re-assertion of the same branch.
});

describe("AccountSettings Danger Zone tab", () => {
  const goToDangerZone = async () => {
    const user = userEvent.setup();
    render(<AccountSettings user={USER} />);
    await user.click(screen.getByRole("button", { name: "Danger Zone" }));
    return user;
  };

  it("renders the destructive Delete Account button", async () => {
    await goToDangerZone();
    expect(
      screen.getByRole("button", { name: /Delete Account/i }),
    ).toBeInTheDocument();
  });

  it("opens the confirmation dialog with the user's email shown in the copy", async () => {
    const user = await goToDangerZone();
    await user.click(screen.getByTestId("open-delete-account-dialog"));

    expect(screen.getByLabelText("delete-account-form")).toBeInTheDocument();
    // The user's email is shown verbatim in the dialog copy so the typed
    // confirmation has a clear target to match against.
    expect(screen.getByText(USER.email)).toBeInTheDocument();
  });

  it("disables the destructive confirm button until the typed email matches", async () => {
    const user = await goToDangerZone();
    await user.click(screen.getByTestId("open-delete-account-dialog"));

    const confirm = screen.getByTestId("delete-account-confirm");
    expect(confirm).toBeDisabled();

    const input = screen.getByTestId("delete-account-confirm-email");
    await user.type(input, "almost-there@example.test");
    expect(confirm).toBeDisabled();

    await user.clear(input);
    await user.type(input, USER.email);
    expect(confirm).toBeEnabled();
  });

  it("renders the password field for credential users", async () => {
    // Default MSW `/list-accounts` returns a credential account, which is
    // the branch the form needs to render the password input.
    const user = await goToDangerZone();
    await user.click(screen.getByTestId("open-delete-account-dialog"));

    expect(screen.getByTestId("delete-account-password")).toBeInTheDocument();
  });

  it("omits the password field for Google-only users", async () => {
    server.use(listAccountsHandler([{ providerId: "google", id: "g-1" }]));

    const user = await goToDangerZone();
    await user.click(screen.getByTestId("open-delete-account-dialog"));

    expect(
      screen.queryByTestId("delete-account-password"),
    ).not.toBeInTheDocument();
  });
});
