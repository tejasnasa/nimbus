/**
 * @module web/tests/components/WorkspaceAiTabs
 * @description The AI surfaces around the settings dialogs: which tabs the
 * workspace settings offer to each role (AI for everyone, Usage for admins
 * only, and there on first render when the server already knows the role),
 * Meetings for everyone, the Usage tab's totals, filters and paging, and the
 * account-level Free usage tab.
 */
import "./testUtils";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@nimbus/types";
import FreeUsagePanel from "../../components/FreeUsagePanel";
import WorkspaceSettings from "../../components/WorkspaceSettings";
import WorkspaceUsagePanel from "../../components/WorkspaceUsagePanel";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";
import { BACKEND_URL, fail, ok } from "../msw/handlers";
import { server } from "../msw/server";
import { aiStatus, callRow, freeUsage, usagePage } from "../msw/aiFixtures";
import { preflight } from "./testUtils";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/workspace/1",
  useParams: () => ({ slugId: "1" }),
  useSearchParams: () => new URLSearchParams(),
}));

const WS = "cm_workspace_0000000000000";
const route = (suffix: string) =>
  `${BACKEND_URL}/api/ai/workspaces/${WS}${suffix}`;

const workspace: Workspace = {
  id: WS,
  name: "Design Guild",
  description: "Shared drafts",
  slug: "design-guild",
  slugId: 1,
  inviteCode: "invite-code",
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  members: [{ id: "user-1", name: "Ada Lovelace", image: null, role: "OWNER" }],
};

beforeEach(() => {
  server.resetHandlers();
  server.use(preflight);
});

function renderSettings(
  initialTab?: string,
  initialAiStatus?: ReturnType<typeof aiStatus>,
) {
  return render(
    <DocEditorRefProvider>
      <WorkspaceSettings
        workspace={workspace}
        documents={[]}
        initialTab={initialTab}
        initialAiStatus={initialAiStatus}
      />
    </DocEditorRefProvider>,
  );
}

describe("WorkspaceSettings: AI tabs", () => {
  it("offers the AI and Usage tabs to an admin", async () => {
    server.use(
      http.get(route("/status"), () => ok(aiStatus({ canManage: true }))),
    );
    renderSettings();

    expect(screen.getByRole("button", { name: "AI" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Usage" }),
    ).toBeInTheDocument();
  });

  it("offers Usage on the first render when the server status is passed in", () => {
    server.use(
      http.get(route("/status"), () => ok(aiStatus({ canManage: true }))),
    );
    renderSettings(undefined, aiStatus({ canManage: true }));

    expect(screen.getByRole("button", { name: "Usage" })).toBeInTheDocument();
  });

  it("offers Meetings to every member", () => {
    server.use(
      http.get(route("/status"), () => ok(aiStatus({ canManage: false }))),
    );
    renderSettings(undefined, aiStatus({ canManage: false }));

    expect(
      screen.getByRole("button", { name: "Meetings" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Usage" }),
    ).not.toBeInTheDocument();
  });

  it("offers a member the AI tab but never Usage", async () => {
    let usageHits = 0;
    server.use(
      http.get(route("/status"), () => ok(aiStatus({ canManage: false }))),
      http.get(route("/usage"), () => {
        usageHits += 1;
        return ok(usagePage());
      }),
    );
    renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "AI" }));
    expect(await screen.findByTestId("ai-member-summary")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Usage" }),
    ).not.toBeInTheDocument();
    expect(usageHits).toBe(0);
  });

  it("opens on the requested tab", async () => {
    server.use(
      http.get(route("/status"), () => ok(aiStatus({ canManage: false }))),
    );
    renderSettings("AI");
    expect(await screen.findByTestId("ai-member-summary")).toBeInTheDocument();
  });

  it("shows the Usage tab's call log", async () => {
    server.use(
      http.get(route("/status"), () => ok(aiStatus({ canManage: true }))),
      http.get(route("/usage"), () => ok(usagePage())),
    );
    renderSettings();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Usage" }));
    expect(await screen.findByTestId("usage-table")).toBeInTheDocument();
  });
});

describe("WorkspaceUsagePanel", () => {
  it("renders totals and a row per call with an estimate or a dash for cost", async () => {
    server.use(
      http.get(route("/usage"), () =>
        ok(
          usagePage([
            callRow({ id: "a", costUsd: 0.0123 }),
            callRow({
              id: "b",
              feature: "transcription",
              audioSeconds: 12.5,
              inputTokens: null,
              outputTokens: null,
              costUsd: null,
              userName: null,
            }),
          ]),
        ),
      ),
    );
    render(<WorkspaceUsagePanel workspaceId={WS} />);

    await screen.findByTestId("usage-table");
    expect(screen.getByTestId("usage-tile-All features")).toHaveTextContent(
      "2 calls",
    );
    expect(screen.getByTestId("usage-row-a")).toHaveTextContent("$0.0123");
    expect(screen.getByTestId("usage-row-a")).toHaveTextContent(
      "100 in / 50 out",
    );
    expect(screen.getByTestId("usage-row-b")).toHaveTextContent("12.5 s");
    expect(screen.getByTestId("usage-row-b")).toHaveTextContent("—");
  });

  it("explains an empty log", async () => {
    server.use(http.get(route("/usage"), () => ok(usagePage([]))));
    render(<WorkspaceUsagePanel workspaceId={WS} />);
    expect(await screen.findByTestId("usage-empty")).toBeInTheDocument();
  });

  it("pages with Next and Previous, replacing the rows", async () => {
    server.use(
      http.get(route("/usage"), ({ request }) =>
        new URL(request.url).searchParams.get("cursor")
          ? ok(usagePage([callRow({ id: "second" })], null))
          : ok(usagePage([callRow({ id: "first" })], "next-page")),
      ),
    );
    render(<WorkspaceUsagePanel workspaceId={WS} />);
    const user = userEvent.setup();

    await screen.findByTestId("usage-row-first");
    expect(screen.getByTestId("usage-pagination-previous")).toBeDisabled();
    await user.click(screen.getByTestId("usage-pagination-next"));

    await screen.findByTestId("usage-row-second");
    expect(screen.queryByTestId("usage-row-first")).not.toBeInTheDocument();
    expect(screen.getByTestId("usage-pagination-page")).toHaveTextContent(
      "Page 2",
    );
    expect(screen.getByTestId("usage-pagination-next")).toBeDisabled();

    await user.click(screen.getByTestId("usage-pagination-previous"));
    await screen.findByTestId("usage-row-first");
    expect(screen.getByTestId("usage-pagination-page")).toHaveTextContent(
      "Page 1",
    );
  });

  it("shows no pager when everything fits on one page", async () => {
    server.use(http.get(route("/usage"), () => ok(usagePage())));
    render(<WorkspaceUsagePanel workspaceId={WS} />);
    await screen.findByTestId("usage-table");
    expect(screen.queryByTestId("usage-pagination")).not.toBeInTheDocument();
  });

  it("re-queries with the chosen filters", async () => {
    const queries: string[] = [];
    server.use(
      http.get(route("/usage"), ({ request }) => {
        queries.push(new URL(request.url).search);
        return ok(usagePage());
      }),
    );
    render(<WorkspaceUsagePanel workspaceId={WS} />);
    const user = userEvent.setup();
    await screen.findByTestId("usage-table");

    await user.click(screen.getByTestId("usage-filter-feature"));
    await user.click(screen.getByRole("option", { name: "Canvas" }));
    await waitFor(() =>
      expect(queries.some((q) => q.includes("feature=canvas"))).toBe(true),
    );
    await user.click(screen.getByTestId("usage-filter-status"));
    await user.click(screen.getByRole("option", { name: "Error" }));
    await waitFor(() =>
      expect(
        queries.some(
          (q) => q.includes("feature=canvas") && q.includes("status=error"),
        ),
      ).toBe(true),
    );
  });

  it("shows the error when the log cannot be read", async () => {
    server.use(http.get(route("/usage"), () => fail(403, "Forbidden")));
    render(<WorkspaceUsagePanel workspaceId={WS} />);
    expect(await screen.findByTestId("usage-error")).toHaveTextContent(
      "Forbidden",
    );
  });
});

describe("FreeUsagePanel", () => {
  it("shows what is left of each allowance", () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/me/free-usage`, () =>
        ok(freeUsage({ docsRemaining: 3 })),
      ),
    );
    render(
      <FreeUsagePanel
        initial={freeUsage({
          docsRemaining: 3,
          voiceSecondsRemaining: 180,
          voiceSecondsLimit: 600,
        })}
      />,
    );
    expect(screen.getByTestId("free-docs")).toHaveTextContent(
      "3 of 5 remaining",
    );
    expect(screen.getByTestId("free-voice")).toHaveTextContent(
      "3 min of 10 min remaining",
    );
  });

  it("says when an allowance is used up and when one is not configured", () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/me/free-usage`, () =>
        ok(freeUsage({ docsState: "exhausted", voiceState: "unconfigured" })),
      ),
    );
    render(
      <FreeUsagePanel
        initial={freeUsage({
          docsState: "exhausted",
          voiceState: "unconfigured",
        })}
      />,
    );
    expect(screen.getByTestId("free-docs")).toHaveTextContent("Used up");
    expect(screen.getByTestId("free-voice")).toHaveTextContent(
      "Not configured",
    );
  });

  it("links the workspaces the user administers", async () => {
    const usage = freeUsage({
      adminWorkspaces: [
        { id: "w1", slugId: 7, name: "Design Guild" },
        { id: "w2", slugId: 9, name: "Ops" },
      ],
    });
    server.use(
      http.get(`${BACKEND_URL}/api/ai/me/free-usage`, () => ok(usage)),
    );
    render(<FreeUsagePanel initial={usage} />);

    const list = screen.getByTestId("free-admin-workspaces");
    expect(within(list).getByText("Design Guild")).toBeInTheDocument();
    expect(screen.getByTestId("free-workspace-link-7")).toHaveAttribute(
      "href",
      "/workspace/7",
    );
    expect(screen.queryByTestId("free-no-workspaces")).not.toBeInTheDocument();
  });

  it("points a non-admin at their workspace admins", () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/me/free-usage`, () => ok(freeUsage())),
    );
    render(<FreeUsagePanel initial={freeUsage()} />);
    expect(screen.getByTestId("free-no-workspaces")).toBeInTheDocument();
  });

  it("keeps the first-paint values and shows the error when the refresh fails", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/me/free-usage`, () => fail(500, "Down")),
    );
    render(<FreeUsagePanel initial={freeUsage({ docsRemaining: 4 })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Down");
    expect(screen.getByTestId("free-docs")).toHaveTextContent(
      "4 of 5 remaining",
    );
  });
});
