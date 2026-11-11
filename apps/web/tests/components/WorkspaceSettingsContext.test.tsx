/**
 * @module web/tests/components/WorkspaceSettingsContext
 * @description The shared settings dialog: it stays closed until something
 * opens it, opens on the tab asked for (the gear on the first tab, the call
 * card's Meetings button on Meetings), switches tab when asked again for another
 * while closed, closes through the controls, and the call card shortcut reaches
 * it end to end.
 */
import "./testUtils";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";
import VoiceDock from "../../components/VoiceDock";
import {
  useOptionalWorkspaceSettings,
  useWorkspaceSettings,
  WorkspaceSettingsProvider,
} from "../../components/WorkspaceSettingsContext";
import WorkspaceSettingsButton from "../../components/WorkspaceSettingsButton";
import { BACKEND_URL, ok } from "../msw/handlers";
import {
  meetingDetail,
  meetingRow,
  segment,
  WS,
  workspace,
} from "../msw/meetingFixtures";
import { aiStatus } from "../msw/aiFixtures";
import { server } from "../msw/server";
import { fakeSocket } from "./fakeSocket";
import { preflight } from "./testUtils";

vi.mock(
  "../../lib/socket",
  async () => (await import("./fakeSocket")).socketModule,
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/workspace/1",
  useParams: () => ({ slugId: "1" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => ({
    connectionState: "disconnected",
    isMuted: false,
    voiceUsers: [],
    participants: [],
    speakingUsers: new Set<string>(),
    join: vi.fn(),
    leave: vi.fn(),
    toggleMute: vi.fn(),
    toggleDeafen: vi.fn(),
    isJoining: false,
    error: null,
    canRejoin: false,
  }),
}));
vi.mock("../../providers/MeetingProvider", () => ({
  useAssistant: () => ({
    meeting: null,
    segments: [],
    assistantState: "stopped",
    isPending: false,
    refusal: null,
    error: null,
    endReason: null,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

function Controls() {
  const settings = useWorkspaceSettings();
  return (
    <>
      <button onClick={() => settings.open("Members")}>open members</button>
      <button onClick={() => settings.open("Meetings")}>
        open meetings tab
      </button>
      <button onClick={() => settings.close()}>close settings</button>
    </>
  );
}

function renderTree(children: React.ReactNode) {
  return render(
    <DocEditorRefProvider>
      <WorkspaceSettingsProvider
        workspace={workspace}
        documents={[]}
        initialAiStatus={aiStatus({ canManage: false })}
        userId="user-1"
      >
        {children}
      </WorkspaceSettingsProvider>
    </DocEditorRefProvider>,
  );
}

const activeTab = () =>
  screen
    .getAllByRole("button")
    .find((b) => b.className.includes("bg-(--primary)/15") && b.textContent);

beforeEach(() => {
  fakeSocket.reset();
  server.resetHandlers();
  server.use(
    preflight,
    http.get(`${BACKEND_URL}/api/meetings`, () =>
      ok({ meetings: [], nextCursor: null }),
    ),
    http.get(`${BACKEND_URL}/api/ai/workspaces/${WS}/status`, () =>
      ok(aiStatus({ canManage: false })),
    ),
  );
});

describe("WorkspaceSettingsProvider", () => {
  it("stays closed until something opens it", () => {
    renderTree(<Controls />);

    expect(
      screen.queryByRole("heading", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });

  it("opens on the first tab from the gear", async () => {
    const user = userEvent.setup();
    renderTree(<WorkspaceSettingsButton />);

    await user.click(
      screen.getByRole("button", { name: "Workspace settings" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(activeTab()).toHaveTextContent("General");
  });

  it("opens on the requested tab and again on another after closing", async () => {
    const user = userEvent.setup();
    renderTree(<Controls />);

    await user.click(screen.getByRole("button", { name: "open meetings tab" }));
    expect(
      await screen.findByTestId("workspace-meetings-panel"),
    ).toBeInTheDocument();
    expect(activeTab()).toHaveTextContent("Meetings");

    await user.click(screen.getByRole("button", { name: "close settings" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Settings" }),
      ).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "open members" }));
    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(activeTab()).toHaveTextContent("Members");
  });

  it("closes with Escape", async () => {
    const user = userEvent.setup();
    renderTree(<Controls />);

    await user.click(screen.getByRole("button", { name: "open members" }));
    await screen.findByRole("heading", { name: "Settings" });
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Settings" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("is reached from the call card's Meetings button", async () => {
    const user = userEvent.setup();
    renderTree(<VoiceDock />);

    await user.click(screen.getByTestId("voice-dock-toggle"));
    await user.click(screen.getByRole("button", { name: "Open meetings" }));

    expect(
      await screen.findByTestId("workspace-meetings-panel"),
    ).toBeInTheDocument();
    expect(activeTab()).toHaveTextContent("Meetings");
  });
});

describe("deleting a meeting from the settings", () => {
  it("confirms and deletes without closing the settings dialog", async () => {
    const user = userEvent.setup();
    let deleted = 0;
    server.use(
      http.get(`${BACKEND_URL}/api/meetings`, () =>
        ok({ meetings: [meetingRow()], nextCursor: null }),
      ),
      http.get(`${BACKEND_URL}/api/meetings/m-1`, () => ok(meetingDetail())),
      http.get(`${BACKEND_URL}/api/meetings/m-1/segments`, () =>
        ok({ segments: [segment(1, "Hello")], hasMore: false }),
      ),
      http.delete(`${BACKEND_URL}/api/meetings/m-1`, () => {
        deleted += 1;
        return ok({ meetingId: "m-1" });
      }),
    );
    renderTree(<Controls />);
    await user.click(screen.getByRole("button", { name: "open meetings tab" }));
    const row = await screen.findByTestId("meeting-row-m-1");
    await user.click(within(row).getByRole("button"));
    await user.click(await screen.findByTestId("delete-meeting"));
    await user.click(await screen.findByTestId("confirm-delete-meeting"));

    expect(await screen.findByTestId("meetings-notice")).toHaveTextContent(
      "Meeting deleted.",
    );
    expect(deleted).toBe(1);
    expect(
      screen.getByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Delete meeting/ })).toBeNull();
  });
});

describe("the settings hooks outside the provider", () => {
  function Probe() {
    const optional = useOptionalWorkspaceSettings();
    return <p>{optional ? "has settings" : "no settings"}</p>;
  }
  function Strict() {
    useWorkspaceSettings();
    return null;
  }

  it("the optional hook reports none", () => {
    render(<Probe />);
    expect(screen.getByText("no settings")).toBeInTheDocument();
  });

  it("the strict hook refuses to run", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Strict />)).toThrow(
      "useWorkspaceSettings must be used within WorkspaceSettingsProvider",
    );
    spy.mockRestore();
  });
});
