/**
 * @module web/tests/components/Meeting
 * @description The assistant's call UI: the start and stop button with its
 * states and reasons, the caption bar (ordering, line limit, speaking line,
 * live-region semantics, the viewer's caption look) and the transcript panel.
 *
 * The shared meeting state and the call are mocked, so each test states
 * exactly the situation it is about.
 */
import "./testUtils";
import type { MeetingDTO, SegmentDTO } from "@nimbus/types";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingState } from "../../hooks/useMeeting";

const assistant = vi.hoisted(() => ({ current: {} as MeetingState }));
const voice = vi.hoisted(() => ({
  current: { participants: [] as unknown[] },
}));

vi.mock("../../providers/MeetingProvider", () => ({
  useAssistant: () => assistant.current,
}));
vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => voice.current,
}));

import AssistantButton from "../../components/meeting/AssistantButton";
import CaptionsBar from "../../components/meeting/CaptionsBar";
import { prefsKey } from "../../hooks/useCaptionPrefs";
import LiveTranscript, {
  formatOffset,
} from "../../components/meeting/LiveTranscript";

const live: MeetingDTO = {
  id: "m1",
  workspaceId: "w1",
  status: "LIVE",
  source: "BYOK",
  startedById: "u1",
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: null,
  endReason: null,
  budgetSeconds: null,
  lastSeq: 0,
};

const seg = (seq: number, extra: Partial<SegmentDTO> = {}): SegmentDTO => ({
  id: `s${seq}`,
  meetingId: "m1",
  seq,
  speakerUserId: "u1",
  speakerName: "Ada",
  text: `line ${seq}`,
  startMs: seq * 1000,
  endMs: seq * 1000 + 500,
  language: null,
  ...extra,
});

const person = (userId: string, name: string, isLocal = false) => ({
  userId,
  name,
  image: null,
  isMuted: false,
  isAgent: false,
  isLocal,
});

function setAssistant(patch: Partial<MeetingState> = {}) {
  assistant.current = {
    meeting: null,
    segments: [],
    assistantState: null,
    speakingUserIds: [],
    endReason: null,
    isPending: false,
    refusal: null,
    error: null,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    ...patch,
  };
}

beforeEach(() => {
  setAssistant();
  voice.current = { participants: [person("u1", "Ada", true)] };
  window.localStorage.clear();
});

describe("AssistantButton", () => {
  it("is disabled, and says why, until the user is in the call", () => {
    render(<AssistantButton inCall={false} />);

    expect(screen.getByRole("button", { name: "Start Nimbus" })).toBeDisabled();
    expect(screen.getByText("Join the call to start Nimbus.")).toBeVisible();
  });

  it("starts the assistant from the call", () => {
    render(<AssistantButton inCall />);

    fireEvent.click(screen.getByRole("button", { name: "Start Nimbus" }));

    expect(assistant.current.start).toHaveBeenCalledTimes(1);
  });

  it("shows progress while a start is in flight", () => {
    setAssistant({ isPending: true });
    render(<AssistantButton inCall />);

    expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
  });

  it("offers Stop with the assistant state while it is live", () => {
    setAssistant({ meeting: live, assistantState: "thinking" });
    render(<AssistantButton inCall />);

    expect(screen.getByTestId("assistant-state")).toHaveTextContent("Thinking");
    fireEvent.click(screen.getByRole("button", { name: "Stop Nimbus" }));
    expect(assistant.current.stop).toHaveBeenCalledTimes(1);
  });

  it("stays usable for stopping even if the user dropped out of the call", () => {
    setAssistant({ meeting: live, assistantState: "listening" });
    render(<AssistantButton inCall={false} />);

    expect(screen.getByRole("button", { name: "Stop Nimbus" })).toBeEnabled();
  });

  it("shows a stop in flight", () => {
    setAssistant({ meeting: live, isPending: true });
    render(<AssistantButton inCall />);

    expect(screen.getByRole("button", { name: "Stopping..." })).toBeDisabled();
  });

  it("shows the server's refusal and any other error as alerts", () => {
    setAssistant({
      refusal: { reason: "no-voice-key", cta: "add-key", message: "Add a key" },
      error: "Try later",
    });
    render(<AssistantButton inCall />);

    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((a) => a.textContent)).toEqual([
      "Add a key",
      "Try later",
    ]);
  });

  it("says why the last meeting ended, when that is worth saying", () => {
    setAssistant({ endReason: "budget" });
    const { rerender } = render(<AssistantButton inCall />);
    expect(
      screen.getByText("Nimbus left because the free assistant time ran out."),
    ).toBeVisible();

    setAssistant({ endReason: "stopped" });
    rerender(<AssistantButton inCall />);
    expect(screen.queryByText(/Nimbus left/)).toBeNull();
  });
});

describe("CaptionsBar", () => {
  it("renders nothing without a live meeting or outside the call", () => {
    const { container, rerender } = render(<CaptionsBar />);
    expect(container).toBeEmptyDOMElement();

    setAssistant({ meeting: live });
    voice.current = { participants: [person("u2", "Grace")] };
    rerender(<CaptionsBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is a polite live region holding the latest lines in order", () => {
    setAssistant({ meeting: live, segments: [seg(1), seg(2), seg(3), seg(4)] });
    render(<CaptionsBar />);

    const region = screen.getByTestId("captions");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(
      screen.getAllByTestId("caption-line").map((l) => l.textContent),
    ).toEqual(["Ada: line 2", "Ada: line 3", "Ada: line 4"]);
  });

  it("invites speech when nothing has been said yet", () => {
    setAssistant({ meeting: live });
    render(<CaptionsBar />);

    expect(screen.getByText("Captions will appear here.")).toBeVisible();
  });

  it("names who is speaking, outside the live region", () => {
    voice.current = {
      participants: [person("u1", "Ada", true), person("u2", "Grace")],
    };
    setAssistant({ meeting: live, speakingUserIds: ["u2", "unknown"] });
    const { rerender } = render(<CaptionsBar />);

    const line = screen.getByTestId("speaking-line");
    expect(line).toHaveTextContent("Grace is speaking...");
    expect(screen.getByTestId("captions")).not.toContainElement(line);

    setAssistant({ meeting: live, speakingUserIds: ["u1", "u2"] });
    rerender(<CaptionsBar />);
    expect(screen.getByTestId("speaking-line")).toHaveTextContent(
      "Ada, Grace are speaking...",
    );
  });

  it("draws captions with the viewer's stored size, contrast and line count", () => {
    window.localStorage.setItem(
      prefsKey("u1"),
      JSON.stringify({ size: "l", highContrast: true, lines: 6 }),
    );
    setAssistant({
      meeting: live,
      segments: [1, 2, 3, 4, 5, 6, 7].map((n) => seg(n)),
    });
    render(<CaptionsBar />);

    expect(screen.getByTestId("captions").className).toContain("text-lg");
    expect(screen.getAllByTestId("caption-line")).toHaveLength(6);
    expect(screen.getByTestId("captions").parentElement!.className).toContain(
      "bg-black",
    );
    expect(
      screen.queryByRole("button", { name: "Caption settings" }),
    ).not.toBeInTheDocument();
  });

  it("restyles when the viewer changes their choice in another tab", () => {
    setAssistant({ meeting: live });
    render(<CaptionsBar />);
    expect(screen.getByTestId("captions").className).toContain("text-sm");

    window.localStorage.setItem(
      prefsKey("u1"),
      JSON.stringify({ size: "s", highContrast: false, lines: 3 }),
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: prefsKey("u1") }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    });

    expect(screen.getByTestId("captions").className).toContain("text-xs");
  });

  it("keeps one user's choices from another", () => {
    window.localStorage.setItem(
      prefsKey("someone-else"),
      JSON.stringify({ size: "l", highContrast: true, lines: 6 }),
    );
    setAssistant({ meeting: live });
    render(<CaptionsBar />);

    expect(screen.getByTestId("captions").className).toContain("text-sm");
  });

  it("falls back to defaults when stored preferences are unusable", () => {
    window.localStorage.setItem(prefsKey("u1"), "{not json");
    setAssistant({ meeting: live });
    const { unmount } = render(<CaptionsBar />);
    expect(screen.getByTestId("captions").className).toContain("text-sm");
    unmount();

    window.localStorage.setItem(
      prefsKey("u1"),
      JSON.stringify({ size: "huge", lines: 9 }),
    );
    render(<CaptionsBar />);
    expect(screen.getByTestId("captions").className).toContain("text-sm");
  });
});

describe("LiveTranscript", () => {
  it("renders nothing when there is nothing to show", () => {
    const { container } = render(<LiveTranscript />);
    expect(container).toBeEmptyDOMElement();
  });

  it("expands to every line with the time into the meeting", () => {
    setAssistant({
      meeting: live,
      segments: [seg(1, { startMs: 5_000 }), seg(2, { startMs: 65_000 })],
    });
    render(<LiveTranscript />);

    expect(screen.queryByTestId("transcript-line")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show transcript (2)" }),
    );

    const lines = screen.getAllByTestId("transcript-line");
    expect(lines.map((l) => l.textContent)).toEqual([
      "0:05Ada: line 1",
      "1:05Ada: line 2",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Hide transcript" }));
    expect(screen.queryByTestId("transcript-line")).toBeNull();
  });

  it("stays available after the meeting ends, and says when it is empty", () => {
    setAssistant({ meeting: live });
    const { rerender } = render(<LiveTranscript />);
    fireEvent.click(screen.getByRole("button", { name: /Show transcript/ }));
    expect(screen.getByText("Nothing said yet.")).toBeVisible();

    setAssistant({ meeting: null, segments: [seg(1)] });
    rerender(<LiveTranscript />);
    expect(screen.getByTestId("transcript-line")).toBeVisible();
  });

  it("keeps scrolling to the newest line until the reader scrolls up", () => {
    setAssistant({ meeting: live, segments: [seg(1)] });
    const { rerender } = render(<LiveTranscript />);
    fireEvent.click(screen.getByRole("button", { name: /Show transcript/ }));
    const list = screen.getByRole("list", { name: "Meeting transcript" });
    Object.defineProperty(list, "scrollHeight", {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(list, "clientHeight", {
      value: 100,
      configurable: true,
    });

    setAssistant({ meeting: live, segments: [seg(1), seg(2)] });
    rerender(<LiveTranscript />);
    expect(list.scrollTop).toBe(500);

    list.scrollTop = 0;
    fireEvent.scroll(list);
    setAssistant({ meeting: live, segments: [seg(1), seg(2), seg(3)] });
    rerender(<LiveTranscript />);
    expect(list.scrollTop).toBe(0);
  });

  it("formats offsets as minutes and seconds", () => {
    expect(formatOffset(0)).toBe("0:00");
    expect(formatOffset(61_999)).toBe("1:01");
    expect(formatOffset(-5)).toBe("0:00");
  });
});
