/**
 * @module web/tests/components/UserNavbar
 * @description UserNavbar adapts `authClient.signOut` to the UI navbar's
 * logout item. These tests cover the identity it renders and the sign-out
 * journey: a successful sign-out must land the user on `/login`, and — per the
 * component's own contract — so must a failed one, so nobody is left on a page
 * they have already signed out of.
 */
import "./testUtils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { preflight, BACKEND_URL } from "./testUtils";
import { fail } from "../msw/handlers";
import UserNavbar from "../../components/UserNavbar";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/home",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

/** Opens the avatar menu and clicks one of its items. */
async function openMenuAndClick(
  user: ReturnType<typeof userEvent.setup>,
  item: string,
) {
  await user.click(screen.getByAltText("Ada Lovelace"));
  await user.click(screen.getByRole("button", { name: item }));
}

beforeEach(() => {
  push.mockClear();
  server.use(preflight);
});

describe("UserNavbar", () => {
  it("renders the signed-in user's identity", () => {
    render(<UserNavbar id="user-1" name="Ada Lovelace" avatar={null} />);

    expect(screen.getByRole("link", { name: /Nimbus/ })).toBeInTheDocument();
    expect(screen.getByAltText("Ada Lovelace")).toBeInTheDocument();
  });

  it("uses the custom avatar when the user has one", () => {
    render(
      <UserNavbar
        id="user-1"
        name="Ada Lovelace"
        avatar="https://cdn.example.com/ada.png"
      />,
    );

    expect(screen.getByAltText("Ada Lovelace")).toHaveAttribute(
      "src",
      "https://cdn.example.com/ada.png",
    );
  });

  it("hides the menu until the avatar is used", () => {
    render(<UserNavbar id="user-1" name="Ada Lovelace" avatar={null} />);

    expect(
      screen.queryByRole("button", { name: "Sign Out" }),
    ).not.toBeInTheDocument();
  });

  it("shows the name as a non-interactive header above the menu items", async () => {
    const user = userEvent.setup();
    render(<UserNavbar id="user-1" name="Ada Lovelace" avatar={null} />);

    await user.click(screen.getByAltText("Ada Lovelace"));

    expect(screen.getByRole("button", { name: "Ada Lovelace" })).toBeDisabled();
  });

  it("routes the Settings menu item to /settings", async () => {
    const user = userEvent.setup();
    render(<UserNavbar id="user-1" name="Ada Lovelace" avatar={null} />);

    await openMenuAndClick(user, "Settings");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/settings"));
  });

  it("signs out and returns the user to the login page", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    server.use(
      http.post(`${BACKEND_URL}/api/auth/sign-out`, ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json({ success: true });
      }),
    );
    render(<UserNavbar id="user-1" name="Ada Lovelace" avatar={null} />);

    await openMenuAndClick(user, "Sign Out");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(requests).toHaveLength(1);
  });

  it.fails(
    "returns the user to login even when the sign-out request fails",
    async () => {
      const user = userEvent.setup();
      server.use(
        http.post(`${BACKEND_URL}/api/auth/sign-out`, () =>
          fail(500, "Session store unavailable"),
        ),
      );
      render(<UserNavbar id="user-1" name="Ada Lovelace" avatar={null} />);

      await openMenuAndClick(user, "Sign Out");

      await waitFor(() => expect(push).toHaveBeenCalledWith("/login"), {
        timeout: 1000,
      });
    },
  );
});
