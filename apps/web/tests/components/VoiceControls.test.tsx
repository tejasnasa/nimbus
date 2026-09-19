/**
 * @module web/tests/components/VoiceControls
 * @description The voice channel header: while the call is still connecting it
 * shows a placeholder instead of dead controls, once connected it renders the
 * roster and the mute/deafen toggles (whose labels must reflect the current
 * state), and the gear opens the workspace settings modal.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

/** Mutable voice state the mocked `useVoice()` reads on every render. */
const voice = vi.hoisted(() => ({
  current: {
    isConnected: true,
    isMuted: false,
    isDeafened: false,
    voiceUsers: [] as { userId: string; name: string; image: string | null; isMuted: boolean }[],
    speakingUsers: new Set<string>(),
    toggleMute: vi.fn(),
    toggleDeafen: vi.fn(),
    localUser: { userId: "user-1", name: "Ada Lovelace", image: null as string | null },
  },
}));

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

/** The gear is an icon-only button with no accessible name. */
const settingsButton = () =>
  screen.getAllByRole("button").at(-1) as HTMLElement;

describe("VoiceControls", () => {
  it("shows a connecting placeholder before the call is up", () => {
    voice.current.isConnected = false;
    voice.current.voiceUsers = [];

    renderControls();

    expect(screen.getByText("Voice Connecting...")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mute Microphone" }),
    ).not.toBeInTheDocument();
  });

  it("renders the roster once connected", () => {
    voice.current.isConnected = true;
    voice.current.voiceUsers = [
      { userId: "user-1", name: "Ada Lovelace", image: null, isMuted: false },
      { userId: "user-2", name: "Grace Hopper", image: null, isMuted: false },
    ];

    renderControls();

    expect(screen.queryByText("Voice Connecting...")).not.toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("shows an unmuted microphone while the user can be heard", () => {
    voice.current.isConnected = true;
    voice.current.isMuted = false;

    renderControls();

    expect(
      screen.getByRole("button", { name: "Mute Microphone" }),
    ).toBeInTheDocument();
  });

  it("flips the microphone control once muted", () => {
    voice.current.isConnected = true;
    voice.current.isMuted = true;

    renderControls();

    expect(
      screen.getByRole("button", { name: "Unmute Microphone" }),
    ).toBeInTheDocument();
  });

  it("toggles the microphone when the control is used", async () => {
    const user = userEvent.setup();
    voice.current.isConnected = true;
    voice.current.isMuted = false;
    voice.current.toggleMute = vi.fn();

    renderControls();
    await user.click(screen.getByRole("button", { name: "Mute Microphone" }));

    expect(voice.current.toggleMute).toHaveBeenCalledTimes(1);
  });

  it("exposes a deafen control that reflects the deafened state", async () => {
    const user = userEvent.setup();
    voice.current.isConnected = true;
    voice.current.isDeafened = false;
    voice.current.toggleDeafen = vi.fn();

    renderControls();
    await user.click(screen.getByRole("button", { name: "Deafen Audio" }));

    expect(voice.current.toggleDeafen).toHaveBeenCalledTimes(1);
  });

  it("labels the deafen control for the opposite action once deafened", () => {
    voice.current.isConnected = true;
    voice.current.isDeafened = true;

    renderControls();

    expect(
      screen.getByRole("button", { name: "Undeafen Audio" }),
    ).toBeInTheDocument();
  });

  it("opens the workspace settings modal from the gear", async () => {
    const user = userEvent.setup();
    voice.current.isConnected = true;

    renderControls();
    await user.click(settingsButton());

    const dialogHeading = await screen.findByRole("heading", {
      name: "Settings",
    });
    expect(dialogHeading).toBeInTheDocument();
    expect(screen.getByText("Design Guild")).toBeInTheDocument();
  });

  it("keeps the settings modal closed until the gear is used", () => {
    voice.current.isConnected = true;

    renderControls();

    expect(
      screen.queryByRole("heading", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });
});
