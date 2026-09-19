/**
 * @module web/tests/components/WorkspaceSettings
 * @description Settings modal behaviour, tab by tab, driven through the real
 * hooks. Coverage focuses on the actions that talk to the API: the dirty-gated
 * rename, member role changes and removals, document creation (including the
 * `DocEditorRefContext` add-tab bridge) and deletion, invite-code copy and
 * rotation, and the danger-zone delete that must leave the workspace route.
 *
 * Every failure case asserts that the user is told what went wrong rather than
 * being left with a silent no-op.
 */
import "./testUtils";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { preflight, BACKEND_URL, stubAlert } from "./testUtils";
import { fail } from "../msw/handlers";
import type { Workspace } from "@nimbus/types";
import type { ClientDocument } from "../../api/document";
import WorkspaceSettings from "../../components/WorkspaceSettings";
import {
  DocEditorRefProvider,
  useDocEditorRef,
} from "../../components/DocEditorRefContext";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
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
  members: [
    { id: "user-1", name: "Ada Lovelace", image: null, role: "OWNER" },
    { id: "user-2", name: "Grace Hopper", image: null, role: "MEMBER" },
  ],
};

const documents: ClientDocument[] = [
  {
    id: "cm_document_00000000000001",
    label: "Readme",
    type: "MARKDOWN",
    elements: [],
    yjsState: null,
  },
];

/**
 * Mounts the modal inside the real `DocEditorRefProvider` and installs an
 * `addTab` spy into the shared ref, exactly as `DocEditor` does.
 */
function renderSettings(onAddTab = vi.fn()) {
  function Bridge() {
    const ref = useDocEditorRef();
    useEffect(() => {
      ref.current = (doc) => onAddTab(doc);
      return () => {
        ref.current = null;
      };
    }, [ref]);
    return null;
  }

  const utils = render(
    <DocEditorRefProvider>
      <Bridge />
      <WorkspaceSettings workspace={workspace} documents={documents} />
    </DocEditorRefProvider>,
  );

  return { ...utils, onAddTab };
}

/** Moves to one of the modal's tabs. */
async function openTab(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(screen.getByRole("button", { name: label }));
}

/** Captures requests to `method path`, returning their parsed bodies. */
function capture(method: "put" | "delete" | "post", path: string, response?: Response) {
  const bodies: unknown[] = [];
  server.use(
    http[method](`${BACKEND_URL}${path}`, async ({ request }) => {
      const text = await request.text();
      bodies.push(text ? JSON.parse(text) : undefined);
      return (
        response ??
        HttpResponse.json({ success: true, responseObject: { slugId: 1 } })
      );
    }),
  );
  return bodies;
}

/**
 * The remove/delete affordances are icon-only buttons, so they are located by
 * position within the row that names the entity rather than by accessible name.
 */
function iconButtonIn(rowText: string) {
  let node: HTMLElement | null = screen.getByText(rowText);
  while (node && node.querySelectorAll("button").length === 0) {
    node = node.parentElement;
  }
  return within(node as HTMLElement)
    .getAllByRole("button")
    .at(-1) as HTMLElement;
}

let alertSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  alertSpy = stubAlert();
  server.use(preflight);
});

describe("WorkspaceSettings", () => {
  describe("general", () => {
    it("prefills the current workspace and holds Save until something changes", async () => {
      const user = userEvent.setup();
      renderSettings();

      expect(screen.getByLabelText("Title")).toHaveValue("Design Guild");
      expect(screen.getByLabelText("Description")).toHaveValue("Shared drafts");
      expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();

      await user.type(screen.getByLabelText("Title"), "!");

      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeEnabled();
    });

    it("saves the rename and refreshes the route", async () => {
      const user = userEvent.setup();
      const bodies = capture("put", `/api/workspace/update/${workspace.id}`);
      renderSettings();

      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "Design Guild II");
      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() =>
        expect(bodies[0]).toMatchObject({
          name: "Design Guild II",
          description: "Shared drafts",
        }),
      );
      expect(refresh).toHaveBeenCalled();
    });

    it("reports a rejected rename", async () => {
      const user = userEvent.setup();
      capture(
        "put",
        `/api/workspace/update/${workspace.id}`,
        fail(403, "Only an owner or admin can rename this workspace"),
      );
      renderSettings();

      await user.type(screen.getByLabelText("Title"), " II");
      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      expect(
        await screen.findByText(
          "Only an owner or admin can rename this workspace",
        ),
      ).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("members", () => {
    it("lists every member with their role", async () => {
      const user = userEvent.setup();
      renderSettings();

      await openTab(user, "Members");

      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
      expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "MEMBER" })).toBeInTheDocument();
    });

    it("changes a member's role through the role menu", async () => {
      const user = userEvent.setup();
      const bodies = capture("put", `/api/workspace/role/${workspace.id}`);
      renderSettings();

      await openTab(user, "Members");
      await user.click(screen.getByRole("button", { name: "MEMBER" }));
      await user.click(screen.getByRole("button", { name: "Admin" }));

      await waitFor(() =>
        expect(bodies[0]).toMatchObject({ memberId: "user-2", role: "ADMIN" }),
      );
      expect(refresh).toHaveBeenCalled();
    });

    it("alerts instead of refreshing when the role change is refused", async () => {
      const user = userEvent.setup();
      capture(
        "put",
        `/api/workspace/role/${workspace.id}`,
        fail(403, "ADMINs cannot promote members"),
      );
      renderSettings();

      await openTab(user, "Members");
      await user.click(screen.getByRole("button", { name: "MEMBER" }));
      await user.click(screen.getByRole("button", { name: "Admin" }));

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith("ADMINs cannot promote members"),
      );
      expect(refresh).not.toHaveBeenCalled();
    });

    it("removes a member only after the confirmation is accepted", async () => {
      const user = userEvent.setup();
      const bodies = capture("delete", `/api/workspace/leave/${workspace.id}`);
      renderSettings();

      await openTab(user, "Members");
      await user.click(iconButtonIn("Grace Hopper"));
      await user.click(
        await screen.findByRole("button", { name: "Remove" }),
      );

      await waitFor(() =>
        expect(bodies[0]).toMatchObject({ memberId: "user-2" }),
      );
      expect(refresh).toHaveBeenCalled();
    });

    it("leaves the member in place when the confirmation is cancelled", async () => {
      const user = userEvent.setup();
      const bodies = capture("delete", `/api/workspace/leave/${workspace.id}`);
      renderSettings();

      await openTab(user, "Members");
      await user.click(iconButtonIn("Grace Hopper"));
      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(bodies).toHaveLength(0);
      expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    });
  });

  describe("documents", () => {
    it("creates a document and hands it to the editor's add-tab bridge", async () => {
      const user = userEvent.setup();
      const bodies: unknown[] = [];
      server.use(
        http.post(`${BACKEND_URL}/api/document/create`, async ({ request }) => {
          const body = (await request.json()) as { title: string; type: string };
          bodies.push(body);
          return HttpResponse.json({
            success: true,
            responseObject: {
              id: "cm_document_00000000000002",
              title: body.title,
              type: body.type,
              canvasData: [],
            },
          });
        }),
      );
      const { onAddTab } = renderSettings();

      await openTab(user, "Documents");
      await user.click(screen.getByRole("button", { name: "+ Add Document" }));
      await user.type(screen.getByLabelText("Title"), "Sprint Plan");
      await user.click(screen.getByRole("button", { name: "CANVAS" }));
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() =>
        expect(bodies[0]).toMatchObject({
          title: "Sprint Plan",
          type: "CANVAS",
          workspaceId: workspace.id,
        }),
      );
      await waitFor(() =>
        expect(onAddTab).toHaveBeenCalledWith(
          expect.objectContaining({ label: "Sprint Plan", type: "CANVAS" }),
        ),
      );
    });

    it("refuses a document title that is too short", async () => {
      const user = userEvent.setup();
      const bodies = capture("post", "/api/document/create");
      renderSettings();

      await openTab(user, "Documents");
      await user.click(screen.getByRole("button", { name: "+ Add Document" }));
      await user.type(screen.getByLabelText("Title"), "ab");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(
        await screen.findByText("Title must be at least 3 characters"),
      ).toBeInTheDocument();
      expect(bodies).toHaveLength(0);
    });

    it("deletes a document after confirmation", async () => {
      const user = userEvent.setup();
      const deleted = capture("delete", `/api/document/${documents[0]!.id}`);
      const reload = vi
        .spyOn(window.location, "reload")
        .mockImplementation(() => {});
      renderSettings();

      await openTab(user, "Documents");
      await user.click(iconButtonIn("Readme"));
      await user.click(await screen.findByRole("button", { name: "Delete" }));

      await waitFor(() => expect(deleted).toHaveLength(1));
      expect(reload).toHaveBeenCalled();
      reload.mockRestore();
    });
  });

  describe("permissions", () => {
    it("copies the invite code and confirms it", async () => {
      const user = userEvent.setup();
      const writeText = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue(undefined);
      renderSettings();

      await openTab(user, "Permissions");
      await user.click(screen.getByRole("button", { name: "Copy Invite Code" }));

      expect(writeText).toHaveBeenCalledWith("invite-code");
      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith("Invite code copied to clipboard!"),
      );
      writeText.mockRestore();
    });

    it("rotates the invite code", async () => {
      const user = userEvent.setup();
      const bodies = capture(
        "put",
        `/api/workspace/regenerate-invite/${workspace.id}`,
      );
      renderSettings();

      await openTab(user, "Permissions");
      await user.click(screen.getByRole("button", { name: "Regenerate" }));

      await waitFor(() => expect(bodies).toHaveLength(1));
    });

    it("alerts when the invite code cannot be rotated", async () => {
      const user = userEvent.setup();
      capture(
        "put",
        `/api/workspace/regenerate-invite/${workspace.id}`,
        fail(403, "Not allowed"),
      );
      renderSettings();

      await openTab(user, "Permissions");
      await user.click(screen.getByRole("button", { name: "Regenerate" }));

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Not allowed"));
    });

    it("deletes the workspace and returns to the dashboard", async () => {
      const user = userEvent.setup();
      const bodies = capture("delete", `/api/workspace/delete/${workspace.id}`);
      renderSettings();

      await openTab(user, "Permissions");
      await user.click(screen.getByRole("button", { name: /Delete Workspace/ }));
      await user.click(
        await screen.findByRole("button", { name: "Delete Forever" }),
      );

      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(push).toHaveBeenCalledWith("/home");
    });
  });
});
