/**
 * @module web/tests/components/AssistantPanel
 * @description Talking to the assistant in the call: the say-its-name hint
 * while it is live, the Stop talking action while it speaks, the viewer's mute
 * toggle, the "answered in chat" state, Nimbus's own caption lines styled
 * apart, and the mute option in the Captions settings tab.
 *
 * The meeting state and the call are mocked; the RPC is a spy.
 */
import "./testUtils";
import type { MeetingDTO, SegmentDTO } from "@nimbus/types";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingState } from "../../hooks/useMeeting";

const assistant = vi.hoisted(() => ({ current: {} as MeetingState }));
const voice = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../providers/MeetingProvider", () => ({
  useAssistant: () => assistant.current,
}));
vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => voice.current,
}));

import AssistantPanel, {
  STOP_FAILED_MESSAGE,
} from "../../components/meeting/AssistantPanel";
import CaptionsBar from "../../components/meeting/CaptionsBar";
import CaptionSettingsPanel from "../../components/CaptionSettingsPanel";
import { prefsKey } from "../../hooks/useCaptionPrefs";

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

const participant = (userId: string, extra: Record<string, unknown> = {}) => ({
  userId,
  name: userId,
  image: null,
  isMuted: false,
  isAgent: false,
  isLocal: false,
  ...extra,
});

const performRpc = vi.fn();

function setAssistant(patch: Partial<MeetingState> = {}) {
  assistant.current = {
    meeting: live,
    segments: [],
    translations: {},
    assistantState: "listening",
    speakingUserIds: [],
    endReason: null,
    isPending: false,
    refusal: null,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    ...patch,
  };
}

function setVoice(withAgent = true) {
  voice.current = {
    room: { localParticipant: { performRpc } },
    localUser: { userId: "u1", name: "Ada", image: null },
    participants: [
      participant("u1", { isLocal: true }),
      ...(withAgent ? [participant("agent-xyz", { isAgent: true })] : []),
    ],
  };
}

const rpcCalls = () =>
  performRpc.mock.calls.map(([params]) => ({
    method: params.method,
    payload: params.payload,
    to: params.destinationIdentity,
  }));

beforeEach(() => {
  performRpc.mockReset();
  performRpc.mockResolvedValue("{}");
  window.localStorage.clear();
  setAssistant();
  setVoice();
});

describe("AssistantPanel in the call", () => {
  it("offers no hold-to-ask button, only a hint to say its name", () => {
    render(<AssistantPanel inCall />);
    expect(screen.queryByTestId("ask-nimbus")).toBeNull();
    expect(screen.getByTestId("wake-hint")).toHaveTextContent(
      "Say \u201cNimbus\u201d to ask it something.",
    );
  });

  it.each(["joining", "stopped"] as const)(
    "hides the hint while the assistant is %s",
    (state) => {
      setAssistant({ assistantState: state });
      render(<AssistantPanel inCall />);
      expect(screen.queryByTestId("wake-hint")).toBeNull();
    },
  );

  it("hides the hint, and the in-call actions, without a meeting", () => {
    setAssistant({ meeting: null, assistantState: null });
    render(<AssistantPanel inCall />);
    expect(screen.queryByTestId("wake-hint")).toBeNull();
    expect(screen.queryByTestId("mute-nimbus")).toBeNull();
    expect(screen.getByRole("button", { name: "Start Nimbus" })).toBeEnabled();
  });

  it("offers Stop talking only while Nimbus is speaking", async () => {
    const { rerender } = render(<AssistantPanel inCall />);
    expect(screen.queryByTestId("stop-nimbus")).toBeNull();

    setAssistant({ assistantState: "speaking" });
    rerender(<AssistantPanel inCall />);
    fireEvent.click(screen.getByTestId("stop-nimbus"));
    await waitFor(() =>
      expect(rpcCalls()).toEqual([
        { method: "nimbus.stop", payload: "{}", to: "agent-xyz" },
      ]),
    );
  });

  it("says so when the agent cannot be reached", async () => {
    performRpc.mockRejectedValueOnce(new Error("timeout"));
    setAssistant({ assistantState: "speaking" });
    render(<AssistantPanel inCall />);
    fireEvent.click(screen.getByTestId("stop-nimbus"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      STOP_FAILED_MESSAGE,
    );
  });

  it("sends nothing when the agent is not in the room", () => {
    setVoice(false);
    setAssistant({ assistantState: "speaking" });
    render(<AssistantPanel inCall />);
    fireEvent.click(screen.getByTestId("stop-nimbus"));
    expect(performRpc).not.toHaveBeenCalled();
  });

  it("mutes Nimbus for this viewer only, remembered per user", async () => {
    render(<AssistantPanel inCall />);
    const toggle = screen.getByTestId("mute-nimbus");
    expect(toggle).toHaveAccessibleName("Mute Nimbus");

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle).toHaveAccessibleName("Unmute Nimbus");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(
      JSON.parse(window.localStorage.getItem(prefsKey("u1"))!).muteAssistant,
    ).toBe(true);
    expect(performRpc).not.toHaveBeenCalled();
  });
});

describe("the assistant's state and lines", () => {
  it("labels an answer that went to chat", () => {
    setAssistant({ assistantState: "answered-in-chat" });
    render(<AssistantPanel inCall />);
    expect(screen.getByTestId("assistant-state")).toHaveTextContent(
      "Answered in chat",
    );
  });

  it("styles Nimbus's own caption lines apart from people's", () => {
    const seg = (seq: number, extra: Partial<SegmentDTO> = {}): SegmentDTO => ({
      id: `s${seq}`,
      meetingId: "m1",
      seq,
      speakerUserId: "u1",
      speakerName: "Ada",
      text: `line ${seq}`,
      startMs: 0,
      endMs: 1,
      language: null,
      ...extra,
    });
    setAssistant({
      segments: [
        seg(1, { addressed: true }),
        seg(2, {
          speakerUserId: null,
          speakerName: "Nimbus",
          fromAssistant: true,
        }),
      ],
    });
    render(<CaptionsBar />);
    const [person, nimbus] = screen.getAllByTestId("caption-line");
    expect(person).not.toHaveAttribute("data-from-assistant");
    expect(nimbus).toHaveAttribute("data-from-assistant", "true");
    expect(nimbus!.className).toContain("italic");
    expect(nimbus).toHaveTextContent("Nimbus: line 2");
  });

  it("styles a translated Nimbus line apart too", () => {
    window.localStorage.setItem(
      prefsKey("u1"),
      JSON.stringify({ language: "es" }),
    );
    setAssistant({
      segments: [
        {
          id: "s1",
          meetingId: "m1",
          seq: 1,
          speakerUserId: null,
          speakerName: "Nimbus",
          text: "Hello",
          startMs: 0,
          endMs: 1,
          language: null,
          fromAssistant: true,
        },
      ],
      translations: { "1:es": "Hola" },
    });
    render(<CaptionsBar />);
    const line = screen.getByTestId("caption-line");
    expect(line).toHaveAttribute("data-from-assistant", "true");
    expect(line.className).toContain("italic");
  });
});

describe("CaptionSettingsPanel", () => {
  it("offers muting Nimbus's voice", async () => {
    render(<CaptionSettingsPanel userId="u1" />);
    const box = screen.getByTestId("caption-mute-assistant");
    expect(box).not.toBeChecked();
    await act(async () => {
      fireEvent.click(box);
    });
    expect(box).toBeChecked();
    expect(
      JSON.parse(window.localStorage.getItem(prefsKey("u1"))!).muteAssistant,
    ).toBe(true);
  });
});
