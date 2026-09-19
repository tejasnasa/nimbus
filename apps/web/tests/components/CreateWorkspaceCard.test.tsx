/**
 * @module web/tests/components/CreateWorkspaceCard
 * @description The dashboard's "New Workspace" card drives two flows on top of
 * the real `useWorkspaceForm` / `useWorkspaceJoinForm` hooks. These tests cover
 * the dialog wiring, the Zod guards that must run before any request, the
 * request payloads, navigation on success, and — critically — that a rejected
 * creation or join is reported instead of being treated as success.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { preflight, BACKEND_URL } from "./testUtils";
import { fail } from "../msw/handlers";
import CreateWorkspaceCard from "../../components/CreateWorkspaceCard";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/home",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

/** Captures the JSON bodies posted to `path`. */
function capture(path: string, response?: Response) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${BACKEND_URL}${path}`, async ({ request }) => {
      bodies.push(await request.json());
      return (
        response ??
        HttpResponse.json({ success: true, responseObject: { slugId: 1 } })
      );
    }),
  );
  return bodies;
}

/** Opens one of the card's two dialogs by clicking its trigger. */
async function openDialog(
  user: ReturnType<typeof userEvent.setup>,
  trigger: string,
) {
  await user.click(screen.getByRole("button", { name: trigger }));
}

beforeEach(() => {
  push.mockClear();
  server.use(preflight);
});

describe("CreateWorkspaceCard", () => {
  it("offers both a create and a join entry point", () => {
    render(<CreateWorkspaceCard />);

    expect(
      screen.getByRole("heading", { name: "New Workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "or join with invite code" }),
    ).toBeInTheDocument();
  });

  describe("create", () => {
    it("opens the create dialog when the primary action is used", async () => {
      const user = userEvent.setup();
      render(<CreateWorkspaceCard />);

      await openDialog(user, "Create Workspace");

      expect(
        screen.getByRole("heading", { name: "Create Workspace" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Title")).toBeInTheDocument();
      expect(screen.getByLabelText("Description")).toBeInTheDocument();
    });

    it("creates the workspace and navigates to it", async () => {
      const user = userEvent.setup();
      const bodies = capture("/api/workspace/create");
      render(<CreateWorkspaceCard />);

      await openDialog(user, "Create Workspace");
      await user.type(screen.getByLabelText("Title"), "Design Guild");
      await user.type(screen.getByLabelText("Description"), "Shared drafts");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(bodies[0]).toMatchObject({
        name: "Design Guild",
        description: "Shared drafts",
      });
      expect(push).toHaveBeenCalledWith("/workspace/1");
    });

    it("refuses a title that is too short without calling the API", async () => {
      const user = userEvent.setup();
      const bodies = capture("/api/workspace/create");
      render(<CreateWorkspaceCard />);

      await openDialog(user, "Create Workspace");
      await user.type(screen.getByLabelText("Title"), "ab");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(
        await screen.findByText("Workspace name must be at least 3 characters"),
      ).toBeInTheDocument();
      expect(bodies).toHaveLength(0);
      expect(push).not.toHaveBeenCalled();
    });

    it("shows the server's rejection instead of navigating away", async () => {
      const user = userEvent.setup();
      capture(
        "/api/workspace/create",
        fail(409, "You already own a workspace with that name"),
      );
      render(<CreateWorkspaceCard />);

      await openDialog(user, "Create Workspace");
      await user.type(screen.getByLabelText("Title"), "Design Guild");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(
        await screen.findByText("You already own a workspace with that name"),
      ).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe("join", () => {
    it("joins with an invite code and navigates to the workspace", async () => {
      const user = userEvent.setup();
      const bodies = capture("/api/workspace/join");
      render(<CreateWorkspaceCard />);

      await openDialog(user, "or join with invite code");

      expect(
        screen.getByRole("heading", { name: "Join Workspace" }),
      ).toBeInTheDocument();
      await user.type(
        screen.getByPlaceholderText("Paste invite code here"),
        "invite-code",
      );
      await user.click(screen.getByRole("button", { name: "Join" }));

      expect(bodies[0]).toMatchObject({ inviteCode: "invite-code" });
      expect(push).toHaveBeenCalledWith("/workspace/1");
    });

    it("reports an invite code the server rejects", async () => {
      const user = userEvent.setup();
      capture("/api/workspace/join", fail(404, "Invalid invite code"));
      render(<CreateWorkspaceCard />);

      await openDialog(user, "or join with invite code");

      expect(
        screen.getByRole("heading", { name: "Join Workspace" }),
      ).toBeInTheDocument();
      await user.type(
        screen.getByPlaceholderText("Paste invite code here"),
        "nope",
      );
      await user.click(screen.getByRole("button", { name: "Join" }));

      expect(await screen.findByText("Invalid invite code")).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
    });
  });
});
