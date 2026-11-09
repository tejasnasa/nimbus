/**
 * @module web/tests/components/CaptionLanguage
 * @description Translated captions on the client: the language picker in the
 * settings Captions tab (saved per user, unknown values ignored), the captions
 * bar showing a translation, falling back to the original while it is in
 * flight and revealing the original on hover or focus, the language being
 * reported to the server when it or the meeting changes, after a reconnect and
 * when changed from the settings tab mid-call, live translations landing in
 * meeting state, and stored translations in the Transcripts tab.
 */
import "./testUtils";
import type { MeetingDTO, SegmentDTO } from "@nimbus/types";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingState } from "../../hooks/useMeeting";

type Handler = (payload: never) => void;

const { socketMock, assistant, voice } = vi.hoisted(() => {
  const listeners = new Map<string, Set<Handler>>();
  return {
    socketMock: {
      connected: true,
      emit: vi.fn(),
      on: vi.fn((event: string, handler: Handler) => {
        const set = listeners.get(event) ?? new Set<Handler>();
        set.add(handler);
        listeners.set(event, set);
      }),
      off: vi.fn((event: string, handler: Handler) => {
        listeners.get(event)?.delete(handler);
      }),
      fire: (event: string, payload?: unknown) => {
        listeners.get(event)?.forEach((h) => h(payload as never));
      },
    },
    assistant: { current: {} as MeetingState },
    voice: { current: { participants: [] as unknown[] } },
  };
});

vi.mock("../../lib/socket", () => ({ socket: socketMock }));
vi.mock("../../providers/MeetingProvider", () => ({
  useAssistant: () => assistant.current,
}));
vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => voice.current,
}));

import CaptionSettingsPanel from "../../components/CaptionSettingsPanel";
import CaptionsBar from "../../components/meeting/CaptionsBar";
import WorkspaceTranscriptsPanel from "../../components/WorkspaceTranscriptsPanel";
import { prefsKey, readPrefs } from "../../hooks/useCaptionPrefs";
import { translationKey, useMeeting } from "../../hooks/useMeeting";
import { BACKEND_URL, ok } from "../msw/handlers";
import { server } from "../msw/server";
import { preflight } from "./testUtils";

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

function setAssistant(patch: Partial<MeetingState> = {}) {
  assistant.current = {
    meeting: live,
    segments: [seg(1), seg(2)],
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

const storeLanguage = (language: string | null) =>
  window.localStorage.setItem(
    prefsKey("u1"),
    JSON.stringify({ size: "m", highContrast: false, lines: 3, language }),
  );

const emitted = () =>
  socketMock.emit.mock.calls.filter((c) => c[0] === "meeting:caption-language");

beforeEach(() => {
  window.localStorage.clear();
  socketMock.connected = true;
  socketMock.emit.mockClear();
  socketMock.on.mockClear();
  socketMock.off.mockClear();
  voice.current = {
    participants: [
      {
        userId: "u1",
        name: "Ada",
        image: null,
        isMuted: false,
        isAgent: false,
        isLocal: true,
      },
    ],
  };
  setAssistant();
  server.resetHandlers();
  server.use(preflight);
});

describe("caption language preference", () => {
  it("defaults to the original and ignores an unsupported stored value", () => {
    expect(readPrefs(prefsKey("u1")).language).toBeNull();
    storeLanguage("xx");
    expect(readPrefs(prefsKey("u1")).language).toBeNull();
    storeLanguage("hi");
    expect(readPrefs(prefsKey("u1")).language).toBe("hi");
  });

  it("is chosen from a picker with an original option, and saved per user", async () => {
    render(<CaptionSettingsPanel userId="u1" />);
    const user = userEvent.setup();

    expect(screen.getByTestId("caption-language")).toHaveTextContent(
      "Original (no translation)",
    );
    await user.click(screen.getByTestId("caption-language"));
    expect(screen.getAllByRole("option")).toHaveLength(21);
    await user.click(screen.getByRole("option", { name: "Hindi" }));

    expect(
      JSON.parse(window.localStorage.getItem(prefsKey("u1"))!),
    ).toMatchObject({ language: "hi" });
    expect(screen.getByTestId("caption-language")).toHaveTextContent("Hindi");

    await user.click(screen.getByTestId("caption-language"));
    await user.click(
      screen.getByRole("option", { name: "Original (no translation)" }),
    );
    expect(
      JSON.parse(window.localStorage.getItem(prefsKey("u1"))!).language,
    ).toBeNull();
  });
});

describe("CaptionsBar translations", () => {
  it("shows the original when no language is chosen, even if translations exist", () => {
    setAssistant({ translations: { [translationKey(1, "hi")]: "एक" } });
    render(<CaptionsBar />);

    expect(screen.getAllByTestId("caption-line")[0]).toHaveTextContent(
      "Ada: line 1",
    );
    expect(screen.queryByTestId("caption-translation")).not.toBeInTheDocument();
  });

  it("falls back to the original for a line whose translation is still in flight", () => {
    storeLanguage("hi");
    setAssistant({ translations: { [translationKey(1, "hi")]: "एक" } });
    render(<CaptionsBar />);

    const [first, second] = screen.getAllByTestId("caption-line");
    expect(first).toHaveTextContent("Ada: एक");
    expect(second).toHaveTextContent("Ada: line 2");
    expect(screen.getAllByTestId("caption-translation")).toHaveLength(1);
  });

  it("uses only the chosen language's translation", () => {
    storeLanguage("es");
    setAssistant({ translations: { [translationKey(1, "hi")]: "एक" } });
    render(<CaptionsBar />);

    expect(screen.getAllByTestId("caption-line")[0]).toHaveTextContent(
      "line 1",
    );
  });

  it("shows the original on hover and on focus, and hides it again", () => {
    storeLanguage("hi");
    setAssistant({ translations: { [translationKey(1, "hi")]: "एक" } });
    render(<CaptionsBar />);
    const line = screen.getAllByTestId("caption-line")[0]!;

    expect(line).toHaveAttribute("title", "Original: line 1");
    expect(line).toHaveAttribute("tabindex", "0");
    expect(screen.queryByTestId("caption-original")).not.toBeInTheDocument();

    fireEvent.mouseEnter(line);
    expect(screen.getByTestId("caption-original")).toHaveTextContent(
      "Original: line 1",
    );
    fireEvent.mouseLeave(line);
    expect(screen.queryByTestId("caption-original")).not.toBeInTheDocument();

    act(() => line.focus());
    expect(screen.getByTestId("caption-original")).toBeInTheDocument();
    act(() => line.blur());
    expect(screen.queryByTestId("caption-original")).not.toBeInTheDocument();
  });
});

describe("reporting the caption language", () => {
  it("emits the chosen language for the live meeting", () => {
    storeLanguage("hi");
    render(<CaptionsBar />);

    expect(emitted()).toContainEqual([
      "meeting:caption-language",
      { meetingId: "m1", language: "hi" },
    ]);
  });

  it("emits again when the language is changed from the settings tab mid-call", async () => {
    storeLanguage("hi");
    render(
      <>
        <CaptionsBar />
        <CaptionSettingsPanel userId="u1" />
      </>,
    );
    const user = userEvent.setup();
    socketMock.emit.mockClear();

    await user.click(screen.getByTestId("caption-language"));
    await user.click(screen.getByRole("option", { name: "Spanish" }));

    await waitFor(() =>
      expect(emitted()).toEqual([
        ["meeting:caption-language", { meetingId: "m1", language: "es" }],
      ]),
    );
  });

  it("re-sends it after the socket reconnects", () => {
    storeLanguage("hi");
    render(<CaptionsBar />);
    socketMock.emit.mockClear();

    act(() => socketMock.fire("connect"));

    expect(emitted()).toEqual([
      ["meeting:caption-language", { meetingId: "m1", language: "hi" }],
    ]);
  });

  it("emits nothing while the socket is down, and clears the choice on leaving", () => {
    storeLanguage("hi");
    socketMock.connected = false;
    const { unmount } = render(<CaptionsBar />);
    expect(emitted()).toEqual([]);

    socketMock.connected = true;
    unmount();
    expect(emitted()).toEqual([
      ["meeting:caption-language", { meetingId: "m1", language: null }],
    ]);
  });

  it("emits nothing when there is no live meeting", () => {
    storeLanguage("hi");
    setAssistant({ meeting: null });
    render(<CaptionsBar />);

    expect(emitted()).toEqual([]);
  });
});

describe("useMeeting translations", () => {
  it("stores a live translation by seq and language for the current meeting only", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/meetings/live`, () => ok({ meeting: live })),
      http.get(`${BACKEND_URL}/api/meetings/m1/segments`, () =>
        ok({ segments: [seg(1)], hasMore: false }),
      ),
    );
    const { result } = renderHook(() => useMeeting("w1"));
    await waitFor(() => expect(result.current.meeting?.id).toBe("m1"));

    act(() => {
      socketMock.fire("meeting:translation", {
        meetingId: "other",
        seq: 1,
        language: "hi",
        text: "ignored",
      });
      socketMock.fire("meeting:translation", {
        meetingId: "m1",
        seq: 1,
        language: "hi",
        text: "एक",
      });
    });

    expect(result.current.translations).toEqual({
      [translationKey(1, "hi")]: "एक",
    });
  });
});

describe("Transcripts tab translations", () => {
  const WS = "cm_workspace_0000000000000";
  const summary = {
    id: "m-1",
    workspaceId: WS,
    status: "ENDED",
    source: "BYOK",
    startedById: "u1",
    startedAt: "2026-11-01T09:00:00.000Z",
    endedAt: "2026-11-01T09:12:00.000Z",
    endReason: "stopped",
    budgetSeconds: null,
    lastSeq: 2,
    startedByName: "Ada",
    segmentCount: 2,
  };

  it("asks for the viewer's language and shows stored translations, original otherwise", async () => {
    storeLanguage("hi");
    const urls: string[] = [];
    server.use(
      http.get(`${BACKEND_URL}/api/meetings`, () =>
        ok({ meetings: [summary], nextCursor: null }),
      ),
      http.get(`${BACKEND_URL}/api/meetings/m-1/segments`, ({ request }) => {
        urls.push(request.url);
        return ok({
          segments: [
            seg(1, { translation: "एक" }),
            seg(2, { translation: null }),
          ],
          hasMore: false,
        });
      }),
    );
    render(<WorkspaceTranscriptsPanel workspaceId={WS} userId="u1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { expanded: false }));

    const lines = await screen.findByTestId("transcript-lines");
    expect(lines).toHaveTextContent("Ada: एक");
    expect(lines).toHaveTextContent("Ada: line 2");
    expect(lines).not.toHaveTextContent("line 1");
    expect(new URL(urls[0]!).searchParams.get("language")).toBe("hi");
  });

  it("asks for no language when none is chosen", async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${BACKEND_URL}/api/meetings`, () =>
        ok({ meetings: [summary], nextCursor: null }),
      ),
      http.get(`${BACKEND_URL}/api/meetings/m-1/segments`, ({ request }) => {
        urls.push(request.url);
        return ok({ segments: [seg(1)], hasMore: false });
      }),
    );
    render(<WorkspaceTranscriptsPanel workspaceId={WS} userId="u1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { expanded: false }));
    await screen.findByTestId("transcript-lines");

    expect(new URL(urls[0]!).searchParams.has("language")).toBe(false);
  });

  it("reloads an open transcript when the caption language changes", async () => {
    const languages: Array<string | null> = [];
    server.use(
      http.get(`${BACKEND_URL}/api/meetings`, () =>
        ok({ meetings: [summary], nextCursor: null }),
      ),
      http.get(`${BACKEND_URL}/api/meetings/m-1/segments`, ({ request }) => {
        const language = new URL(request.url).searchParams.get("language");
        languages.push(language);
        return ok({
          segments: [seg(1, language ? { translation: `${language}!` } : {})],
          hasMore: false,
        });
      }),
    );
    render(
      <>
        <CaptionSettingsPanel userId="u1" />
        <WorkspaceTranscriptsPanel workspaceId={WS} userId="u1" />
      </>,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { expanded: false }));
    expect(await screen.findByTestId("transcript-lines")).toHaveTextContent(
      "line 1",
    );

    await user.click(screen.getByTestId("caption-language"));
    await user.click(screen.getByRole("option", { name: "French" }));

    await waitFor(() =>
      expect(screen.getByTestId("transcript-lines")).toHaveTextContent("fr!"),
    );
    expect(languages).toEqual([null, "fr"]);
  });
});
