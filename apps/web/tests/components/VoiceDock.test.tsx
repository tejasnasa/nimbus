/**
 * @module web/tests/components/VoiceDock
 * @description The floating call entry point: a small pill that opens the call
 * card and never joins or leaves on its own, labelled Start meeting or Join
 * meeting (with the head count) before the user is on the call, and In meeting
 * (and muted) once they are. The card header offers a shortcut to the Meetings
 * tab of the workspace settings.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VoiceDock from "../../components/VoiceDock";
import type { WorkspaceSettingsControls } from "../../components/WorkspaceSettingsContext";

const initialVoice = () => ({
  connectionState: "disconnected",
  isMuted: false,
  voiceUsers: [] as { userId: string; name: string; image: string | null }[],
  join: vi.fn(),
  leave: vi.fn(),
});

/** Mutable voice state the mocked `useVoice()` reads on every render. */
const voice = vi.hoisted(() => ({
  current: {} as ReturnType<typeof initialVoice>,
}));

vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => voice.current,
}));

const settings = vi.hoisted(() => ({
  current: null as WorkspaceSettingsControls | null,
}));

vi.mock("../../components/WorkspaceSettingsContext", () => ({
  useOptionalWorkspaceSettings: () => settings.current,
}));

vi.mock("../../components/VoiceControls", () => ({
  default: () => <div data-testid="voice-controls" />,
}));

beforeEach(() => {
  voice.current = initialVoice();
  settings.current = null;
});

describe("VoiceDock", () => {
  it("starts collapsed as a Start meeting pill when the call is empty", () => {
    render(<VoiceDock />);

    expect(
      screen.getByRole("button", { name: /Start meeting/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Join meeting/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("voice-card")).not.toBeInTheDocument();
  });

  it("offers Join meeting and counts who is already on the call", () => {
    voice.current.voiceUsers = [
      { userId: "u2", name: "Grace", image: null },
      { userId: "u3", name: "Alan", image: null },
    ];
    render(<VoiceDock />);

    expect(screen.getByTestId("voice-dock-toggle")).toHaveTextContent(
      "Join meeting2",
    );
  });

  it("opens the call card without joining, and hides it again", async () => {
    const user = userEvent.setup();
    render(<VoiceDock />);

    await user.click(screen.getByTestId("voice-dock-toggle"));
    expect(screen.getByTestId("voice-card")).toBeInTheDocument();
    expect(screen.getByTestId("voice-controls")).toBeInTheDocument();
    expect(voice.current.join).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Hide meeting" }));
    expect(screen.queryByTestId("voice-card")).not.toBeInTheDocument();
    expect(voice.current.leave).not.toHaveBeenCalled();
  });

  it("says when the user is on the call and muted", () => {
    voice.current.connectionState = "connected";
    voice.current.isMuted = true;
    render(<VoiceDock />);

    const pill = screen.getByTestId("voice-dock-toggle");
    expect(pill).toHaveTextContent("In meeting");
    expect(pill).toHaveTextContent("muted");
  });

  it("opens the workspace settings on the Meetings tab from the card", async () => {
    const user = userEvent.setup();
    settings.current = { open: vi.fn(), close: vi.fn() };
    render(<VoiceDock />);

    await user.click(screen.getByTestId("voice-dock-toggle"));
    await user.click(screen.getByRole("button", { name: "Open meetings" }));

    expect(settings.current.open).toHaveBeenCalledWith("Meetings");
  });

  it("omits the Meetings shortcut where there are no settings to open", async () => {
    const user = userEvent.setup();
    render(<VoiceDock />);

    await user.click(screen.getByTestId("voice-dock-toggle"));

    expect(
      screen.queryByRole("button", { name: "Open meetings" }),
    ).not.toBeInTheDocument();
  });

  it("drops the muted cue once the microphone is on", () => {
    voice.current.connectionState = "connected";
    render(<VoiceDock />);

    expect(screen.getByTestId("voice-dock-toggle")).not.toHaveTextContent(
      "muted",
    );
  });
});
