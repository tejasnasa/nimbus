/**
 * @module web/tests/components/VoiceControls
 * @description The call header. Before joining it shows who is already on the
 * call and a Join call button; once in, the participants with their mute state
 * and the mute, deafen and leave controls (whose labels must reflect the
 * current state). Provider errors are shown inline, a dropped call offers
 * Rejoin, and the gear opens the workspace settings modal in every state.
 */
import "./testUtils";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@nimbus/types";
import type { ClientDocument } from "../../api/document";
import VoiceControls from "../../components/VoiceControls";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/workspace/1",
  useParams: () => ({ slugId: "1" }),
  useSearchParams: () => new URLSearchParams(),
}));

type Participant = {
  userId: string;
  name: string;
  image: string | null;
  isMuted: boolean;
  isAgent: boolean;
  isLocal: boolean;
};

const initialVoice = () => ({
  isConnected: false,
  isMuted: false,
  isDeafened: false,
  voiceUsers: [] as { userId: string; name: string; image: string | null }[],
  participants: [] as Participant[],
  speakingUsers: new Set<string>(),
  toggleMute: vi.fn(),
  toggleDeafen: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
  isJoining: false,
  connectionState: "disconnected",
  error: null as string | null,
  canRejoin: false,
  localUser: { userId: "user-1", name: "Ada Lovelace", image: null },
});

/** Mutable voice state the mocked `useVoice()` reads on every render. */
const voice = vi.hoisted(() => ({ current: {} as ReturnType<typeof initialVoice> }));

vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => voice.current,
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

const documents: ClientDocument[] = [];

function renderControls() {
  return render(
    <DocEditorRefProvider>
      <VoiceControls documents={documents} workspaceData={workspace} />
    </DocEditorRefProvider>,
  );
}

/** Puts the mocked provider into a connected call. */
function connect(overrides: Partial<ReturnType<typeof initialVoice>> = {}) {
  Object.assign(voice.current, {
    isConnected: true,
    connectionState: "connected",
    participants: [
      {
        userId: "user-1",
        name: "Ada Lovelace",
        image: null,
        isMuted: false,
        isAgent: false,
        isLocal: true,
      },
    ],
    ...overrides,
  });
}

/** The gear is an icon-only button; its title names it. */
const settingsButton = () =>
  screen.getByRole("button", { name: "Workspace settings" });

beforeEach(() => {
  voice.current = initialVoice();
});

describe("VoiceControls: before joining", () => {
  it("offers a Join call button", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Join call" }));

    expect(voice.current.join).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Mute Microphone" }),
    ).not.toBeInTheDocument();
  });

  it("says when no one is on the call", () => {
    renderControls();

    expect(screen.getByTestId("call-roster")).toHaveTextContent(
      "No one is on the call",
    );
  });

  it("names who is already on the call, from the roster", () => {
    voice.current.voiceUsers = [
      { userId: "user-2", name: "Grace Hopper", image: null },
    ];
    renderControls();

    expect(screen.getByTestId("call-roster")).toHaveTextContent(
      "Grace Hopper is on the call",
    );
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("names two and counts the rest", () => {
    voice.current.voiceUsers = [
      { userId: "u2", name: "Grace", image: null },
      { userId: "u3", name: "Alan", image: null },
    ];
    const { unmount } = renderControls();
    expect(screen.getByTestId("call-roster")).toHaveTextContent(
      "Grace and Alan are on the call",
    );
    unmount();

    voice.current.voiceUsers = [
      { userId: "u2", name: "Grace", image: null },
      { userId: "u3", name: "Alan", image: null },
      { userId: "u4", name: "Edsger", image: null },
      { userId: "u5", name: "Barbara", image: null },
    ];
    renderControls();
    expect(screen.getByTestId("call-roster")).toHaveTextContent(
      "Grace, Alan and 2 more are on the call",
    );
  });

  it("disables the button and says so while joining", () => {
    voice.current.isJoining = true;
    renderControls();

    expect(screen.getByRole("button", { name: "Joining..." })).toBeDisabled();
  });

  it("shows why a join failed", () => {
    voice.current.error = "Couldn't connect to the call.";
    renderControls();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't connect to the call.",
    );
  });

  it("offers Rejoin instead of Join once the call has dropped", async () => {
    const user = userEvent.setup();
    voice.current.canRejoin = true;
    voice.current.error = "You were disconnected from the call.";
    renderControls();

    expect(
      screen.queryByRole("button", { name: "Join call" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rejoin" }));

    expect(voice.current.join).toHaveBeenCalledTimes(1);
  });

  it("keeps the settings gear reachable", () => {
    renderControls();

    expect(settingsButton()).toBeInTheDocument();
  });
});

describe("VoiceControls: in the call", () => {
  it("replaces Join call with the call controls", () => {
    connect();
    renderControls();

    expect(
      screen.queryByRole("button", { name: "Join call" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Leave call" }),
    ).toBeInTheDocument();
  });

  it("lists the participants and marks who is muted", () => {
    connect({
      participants: [
        {
          userId: "user-1",
          name: "Ada Lovelace",
          image: null,
          isMuted: false,
          isAgent: false,
          isLocal: true,
        },
        {
          userId: "user-2",
          name: "Grace Hopper",
          image: null,
          isMuted: true,
          isAgent: false,
          isLocal: false,
        },
      ],
    });
    renderControls();

    const list = screen.getByRole("list", { name: "On the call" });
    const [ada, grace] = within(list).getAllByTestId("call-participant");
    expect(ada).toHaveTextContent("Ada Lovelace");
    expect(ada).toHaveAttribute("data-muted", "false");
    expect(grace).toHaveTextContent("Grace Hopper");
    expect(grace).toHaveAttribute("data-muted", "true");
    expect(grace).toHaveTextContent("muted");
  });

  it("badges the agent", () => {
    connect({
      participants: [
        {
          userId: "agent-1",
          name: "Nimbus",
          image: null,
          isMuted: false,
          isAgent: true,
          isLocal: false,
        },
      ],
    });
    renderControls();

    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("shows an unmuted microphone while the user can be heard", () => {
    connect({ isMuted: false });
    renderControls();

    expect(
      screen.getByRole("button", { name: "Mute Microphone" }),
    ).toBeInTheDocument();
  });

  it("flips the microphone control once muted", () => {
    connect({ isMuted: true });
    renderControls();

    expect(
      screen.getByRole("button", { name: "Unmute Microphone" }),
    ).toBeInTheDocument();
  });

  it("toggles the microphone when the control is used", async () => {
    const user = userEvent.setup();
    connect({ isMuted: false });
    renderControls();

    await user.click(screen.getByRole("button", { name: "Mute Microphone" }));

    expect(voice.current.toggleMute).toHaveBeenCalledTimes(1);
  });

  it("exposes a deafen control that reflects the deafened state", async () => {
    const user = userEvent.setup();
    connect({ isDeafened: false });
    renderControls();

    await user.click(screen.getByRole("button", { name: "Deafen Audio" }));

    expect(voice.current.toggleDeafen).toHaveBeenCalledTimes(1);
  });

  it("labels the deafen control for the opposite action once deafened", () => {
    connect({ isDeafened: true });
    renderControls();

    expect(
      screen.getByRole("button", { name: "Undeafen Audio" }),
    ).toBeInTheDocument();
  });

  it("leaves the call", async () => {
    const user = userEvent.setup();
    connect();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Leave call" }));

    expect(voice.current.leave).toHaveBeenCalledTimes(1);
  });

  it("shows a reconnecting status and holds the toggles while it lasts", () => {
    connect({ isConnected: false, connectionState: "reconnecting" });
    renderControls();

    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mute Microphone" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Leave call" }),
    ).toBeEnabled();
  });

  it("shows a refused microphone inline", () => {
    connect({ error: "Microphone access is blocked." });
    renderControls();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Microphone access is blocked.",
    );
  });
});

describe("VoiceControls: settings", () => {
  it("opens the workspace settings modal from the gear", async () => {
    const user = userEvent.setup();
    connect();
    renderControls();

    await user.click(settingsButton());

    const dialogHeading = await screen.findByRole("heading", {
      name: "Settings",
    });
    expect(dialogHeading).toBeInTheDocument();
    expect(screen.getByText("Design Guild")).toBeInTheDocument();
  });

  it("keeps the settings modal closed until the gear is used", () => {
    connect();
    renderControls();

    expect(
      screen.queryByRole("heading", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });
});
