/**
 * @module web/tests/components/VoiceControls
 * @description The call card body. Before joining it shows who is already on
 * the call and a Start or Join meeting button; once in, the participants as an avatar stack
 * with their mute and speaking state, and the mute, deafen and leave controls
 * (whose labels must reflect the current state). Provider errors are shown
 * inline and a dropped call offers Rejoin.
 */
import "./testUtils";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
const voice = vi.hoisted(() => ({
  current: {} as ReturnType<typeof initialVoice>,
}));

vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => voice.current,
}));

function renderControls() {
  return render(
    <DocEditorRefProvider>
      <VoiceControls />
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

beforeEach(() => {
  voice.current = initialVoice();
});

describe("VoiceControls: before joining", () => {
  it("offers Start meeting while nobody is on the call", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Start meeting" }));

    expect(voice.current.join).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Join meeting" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mute Microphone" }),
    ).not.toBeInTheDocument();
  });

  it("offers Join meeting once someone is on the call", async () => {
    const user = userEvent.setup();
    voice.current.voiceUsers = [
      { userId: "user-2", name: "Grace Hopper", image: null },
    ];
    renderControls();

    await user.click(screen.getByRole("button", { name: "Join meeting" }));

    expect(voice.current.join).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Start meeting" }),
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
      screen.queryByRole("button", { name: "Start meeting" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rejoin" }));

    expect(voice.current.join).toHaveBeenCalledTimes(1);
  });
});

describe("VoiceControls: in the call", () => {
  it("replaces Start meeting with the call controls", () => {
    connect();
    renderControls();

    expect(
      screen.queryByRole("button", { name: "Start meeting" }),
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
    expect(ada).toHaveAttribute("title", "Ada Lovelace");
    expect(ada).toHaveAttribute("data-muted", "false");
    expect(within(ada!).getByRole("img")).toHaveAccessibleName("Ada Lovelace");
    expect(grace).toHaveAttribute("title", "Grace Hopper (muted)");
    expect(grace).toHaveAttribute("data-muted", "true");
    expect(grace).toHaveTextContent("muted");
  });

  it("rings whoever is speaking", () => {
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
          isMuted: false,
          isAgent: false,
          isLocal: false,
        },
      ],
      speakingUsers: new Set(["user-2"]),
    });
    renderControls();

    expect(screen.getByRole("img", { name: "Grace Hopper" })).toHaveClass(
      "border-(--chart-2)",
    );
    expect(screen.getByRole("img", { name: "Ada Lovelace" })).not.toHaveClass(
      "border-(--chart-2)",
    );
  });

  it("badges the agent", () => {
    connect({
      participants: [
        {
          userId: "agent-1",
          name: "NimbusBot",
          image: null,
          isMuted: false,
          isAgent: true,
          isLocal: false,
        },
      ],
    });
    renderControls();

    expect(screen.getByText("Bot")).toBeInTheDocument();
    expect(screen.getByTestId("call-participant")).toHaveAttribute(
      "title",
      "NimbusBot",
    );
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
    expect(screen.getByRole("button", { name: "Leave call" })).toBeEnabled();
  });

  it("shows a refused microphone inline", () => {
    connect({ error: "Microphone access is blocked." });
    renderControls();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Microphone access is blocked.",
    );
  });
});
