/**
 * @module web/tests/components/VoiceOverlay
 * @description Behaviour of the floating "who is talking" badges: nobody
 * speaking renders nothing, a speaker appears immediately, the badge is keyed
 * to the right identity (local user vs. remote peer), the assistant carries an
 * Agent badge told apart by kind rather than name, and a badge lingers for the
 * 1.5s grace period after the speaker stops before being swept away.
 */
import "./testUtils";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VoiceOverlay from "../../components/VoiceOverlay";

type Participant = {
  userId: string;
  name: string;
  image: string | null;
  isMuted: boolean;
  isAgent: boolean;
  isLocal: boolean;
};

/** Mutable voice state the mocked `useVoice()` reads on every render. */
const voice = vi.hoisted(() => ({
  current: {
    speakingUsers: new Set<string>(),
    participants: [] as Participant[],
  },
}));

vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => voice.current,
}));

const person = (
  userId: string,
  name: string,
  extra: Partial<Participant> = {},
): Participant => ({
  userId,
  name,
  image: null,
  isMuted: false,
  isAgent: false,
  isLocal: false,
  ...extra,
});

function setVoice(speakingUsers: string[], participants: Participant[] = []) {
  voice.current.speakingUsers = new Set(speakingUsers);
  voice.current.participants = participants;
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
    setVoice(["user-2"], [person("user-2", "Grace Hopper")]);

    render(<VoiceOverlay />);

    expect(screen.getByAltText("Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });

  it("prefers the peer's custom avatar over the fallback", () => {
    setVoice(
      ["user-2"],
      [
        person("user-2", "Grace Hopper", {
          image: "https://cdn.example.com/grace.png",
        }),
      ],
    );

    render(<VoiceOverlay />);

    expect(screen.getByAltText("Grace Hopper")).toHaveAttribute(
      "src",
      "https://cdn.example.com/grace.png",
    );
  });

  /**
   * A badge outlives the moment it appeared, and the participant list can gain
   * an avatar after that moment. Reading identity from it at render time is
   * what lets the real picture replace the fallback; a snapshot taken when the
   * speaker started speaking would pin the fallback for the badge's whole life.
   */
  it("adopts an avatar that arrives after the speaker started talking", () => {
    const avatar = "https://cdn.example.com/grace.png";
    setVoice(["user-2"], [person("user-2", "Grace Hopper")]);

    const { rerender } = render(<VoiceOverlay />);
    expect(screen.getByAltText("Grace Hopper")).not.toHaveAttribute(
      "src",
      avatar,
    );

    setVoice(["user-2"], [person("user-2", "Grace Hopper", { image: avatar })]);
    rerender(<VoiceOverlay />);

    expect(screen.getByAltText("Grace Hopper")).toHaveAttribute("src", avatar);
  });

  it("identifies the local user from their own participant entry", () => {
    setVoice(["user-1"], [person("user-1", "Ada Lovelace", { isLocal: true })]);

    render(<VoiceOverlay />);

    expect(screen.getByAltText("Ada Lovelace")).toBeInTheDocument();
  });

  it("falls back to a neutral name for a speaker it has no entry for", () => {
    setVoice(["user-9"], []);

    render(<VoiceOverlay />);

    expect(screen.getByAltText("Peer")).toBeInTheDocument();
  });

  it("badges the assistant as an agent", () => {
    setVoice(
      ["agent-1"],
      [person("agent-1", "Nimbus", { isAgent: true })],
    );

    render(<VoiceOverlay />);

    expect(screen.getByAltText("Nimbus")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("does not badge a person whose display name happens to be Agent", () => {
    setVoice(["user-3"], [person("user-3", "Agent")]);

    render(<VoiceOverlay />);

    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });

  it("keeps a badge for the grace period after the speaker goes quiet", () => {
    vi.useFakeTimers();
    setVoice(["user-2"], [person("user-2", "Grace Hopper")]);

    const { rerender } = render(<VoiceOverlay />);
    expect(screen.getByAltText("Grace Hopper")).toBeInTheDocument();

    setVoice([], [person("user-2", "Grace Hopper")]);
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

  it("keeps the last known identity for a speaker who left the call", () => {
    vi.useFakeTimers();
    setVoice(["user-2"], [person("user-2", "Grace Hopper")]);

    const { rerender } = render(<VoiceOverlay />);

    setVoice([], []);
    rerender(<VoiceOverlay />);

    expect(screen.getByAltText("Grace Hopper")).toBeInTheDocument();
  });
});
