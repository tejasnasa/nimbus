/**
 * @module web/tests/components/VoiceDock
 * @description The floating call entry point: a small pill that opens the call
 * card and never joins or leaves on its own, labelled for whether the user is
 * on the call (and muted) or how many people already are.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VoiceDock from "../../components/VoiceDock";

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

vi.mock("../../components/VoiceControls", () => ({
  default: () => <div data-testid="voice-controls" />,
}));

beforeEach(() => {
  voice.current = initialVoice();
});

describe("VoiceDock", () => {
  it("starts collapsed as a Join voice call pill", () => {
    render(<VoiceDock />);

    expect(
      screen.getByRole("button", { name: /Join voice call/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("voice-card")).not.toBeInTheDocument();
  });

  it("counts who is already on the call", () => {
    voice.current.voiceUsers = [
      { userId: "u2", name: "Grace", image: null },
      { userId: "u3", name: "Alan", image: null },
    ];
    render(<VoiceDock />);

    expect(screen.getByTestId("voice-dock-toggle")).toHaveTextContent(
      "Join voice call2",
    );
  });

  it("opens the call card without joining, and hides it again", async () => {
    const user = userEvent.setup();
    render(<VoiceDock />);

    await user.click(screen.getByTestId("voice-dock-toggle"));
    expect(screen.getByTestId("voice-card")).toBeInTheDocument();
    expect(screen.getByTestId("voice-controls")).toBeInTheDocument();
    expect(voice.current.join).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Hide voice call" }));
    expect(screen.queryByTestId("voice-card")).not.toBeInTheDocument();
    expect(voice.current.leave).not.toHaveBeenCalled();
  });

  it("says when the user is on the call and muted", () => {
    voice.current.connectionState = "connected";
    voice.current.isMuted = true;
    render(<VoiceDock />);

    const pill = screen.getByTestId("voice-dock-toggle");
    expect(pill).toHaveTextContent("In voice call");
    expect(pill).toHaveTextContent("muted");
  });

  it("drops the muted cue once the microphone is on", () => {
    voice.current.connectionState = "connected";
    render(<VoiceDock />);

    expect(screen.getByTestId("voice-dock-toggle")).not.toHaveTextContent(
      "muted",
    );
  });
});
