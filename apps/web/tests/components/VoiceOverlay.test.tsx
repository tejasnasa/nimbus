/**
 * @module web/tests/components/VoiceOverlay
 * @description Behaviour of the floating "who is talking" badges: nobody
 * speaking renders nothing, a speaker appears immediately, the badge is keyed
 * to the right identity (local user vs. remote peer), and it lingers for the
 * 1.5s grace period after the speaker stops before being swept away.
 */
import "./testUtils";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VoiceOverlay from "../../components/VoiceOverlay";

/** Mutable voice state the mocked `useVoice()` reads on every render. */
const voice = vi.hoisted(() => ({
  current: {
    isConnected: true,
    isMuted: false,
    isDeafened: false,
    voiceUsers: [] as { userId: string; name: string; image: string | null; isMuted: boolean }[],
    speakingUsers: new Set<string>(),
    toggleMute: () => {},
    toggleDeafen: () => {},
    localUser: { userId: "user-1", name: "Ada Lovelace", image: null as string | null },
  },
}));

vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => voice.current,
}));

function setVoice(
  speakingUsers: string[],
  voiceUsers: typeof voice.current.voiceUsers = [],
) {
  voice.current.speakingUsers = new Set(speakingUsers);
  voice.current.voiceUsers = voiceUsers;
}

afterEach(() => {
  vi.useRealTimers();
  setVoice([]);
});

describe("VoiceOverlay", () => {
  it("renders nothing while the channel is silent", () => {
    setVoice([]);

    const { container } = render(<VoiceOverlay />);

    expect(container).toBeEmptyDOMElement();
  });

  it("badges a remote peer with their name as soon as they speak", () => {
    setVoice(["user-2"], [
      { userId: "user-2", name: "Grace Hopper", image: null, isMuted: false },
    ]);

    render(<VoiceOverlay />);

    expect(screen.getByAltText("Grace Hopper")).toBeInTheDocument();
  });

  it("prefers the peer's custom avatar over the fallback", () => {
    setVoice(["user-2"], [
      {
        userId: "user-2",
        name: "Grace Hopper",
        image: "https://cdn.example.com/grace.png",
        isMuted: false,
      },
    ]);

    render(<VoiceOverlay />);

    expect(screen.getByAltText("Grace Hopper")).toHaveAttribute(
      "src",
      "https://cdn.example.com/grace.png",
    );
  });

  it("identifies the local user without consulting the peer roster", () => {
    setVoice(["user-1"]);

    render(<VoiceOverlay />);

    expect(screen.getByAltText("Ada Lovelace")).toBeInTheDocument();
  });

  it("keeps a badge for the grace period after the speaker goes quiet", () => {
    vi.useFakeTimers();
    setVoice(["user-2"], [
      { userId: "user-2", name: "Grace Hopper", image: null, isMuted: false },
    ]);

    const { rerender } = render(<VoiceOverlay />);
    expect(screen.getByAltText("Grace Hopper")).toBeInTheDocument();

    setVoice([]);
    rerender(<VoiceOverlay />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByAltText("Grace Hopper")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.queryByAltText("Grace Hopper")).not.toBeInTheDocument();
  });
});
