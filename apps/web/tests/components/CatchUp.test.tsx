/**
 * @module web/tests/components/CatchUp
 * @description "Catch me up" during a call: the card appears only once the
 * meeting is more than two minutes old (including when it crosses the line while
 * on screen), is asked for on demand, shows the summary as bullets, can fail and
 * retry, and stays dismissed per meeting. The transcript panel has its own
 * button that shows the same summary, and the captions bar hosts the card.
 */
import "./testUtils";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingDTO } from "@nimbus/types";
import type { MeetingState } from "../../hooks/useMeeting";
import { BACKEND_URL, fail, ok } from "../msw/handlers";
import { server } from "../msw/server";
import { preflight } from "./testUtils";

const { assistant, voice } = vi.hoisted(() => ({
  assistant: { current: {} as MeetingState },
  voice: { current: { participants: [] as unknown[] } },
}));

vi.mock(
  "../../lib/socket",
  async () => (await import("./fakeSocket")).socketModule,
);
vi.mock("../../providers/MeetingProvider", () => ({
  useAssistant: () => assistant.current,
}));
vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => voice.current,
}));

import CaptionsBar from "../../components/meeting/CaptionsBar";
import CatchUpCard, {
  CATCH_UP_AFTER_MS,
} from "../../components/meeting/CatchUpCard";
import LiveTranscript from "../../components/meeting/LiveTranscript";
import { summaryBullets } from "../../components/meeting/CatchUpSummary";
import { fakeSocket } from "./fakeSocket";

const CATCH_UP = `${BACKEND_URL}/api/meetings/m1/catch-up`;

const meetingStartedAgo = (ms: number, id = "m1"): MeetingDTO => ({
  id,
  workspaceId: "w1",
  status: "LIVE",
  source: "BYOK",
  startedById: "u1",
  startedAt: new Date(Date.now() - ms).toISOString(),
  endedAt: null,
  endReason: null,
  budgetSeconds: null,
  lastSeq: 0,
});

const setMeeting = (meeting: MeetingDTO | null) => {
  assistant.current = {
    meeting,
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
  } as MeetingState;
};

const answer = (summary: string | null) =>
  http.get(CATCH_UP, () =>
    ok({
      summary,
      upToSeq: 4,
      generatedAt: "2026-11-01T09:03:00.000Z",
      minutesElapsed: 3,
    }),
  );

beforeEach(() => {
  fakeSocket.reset();
  window.sessionStorage.clear();
  window.localStorage.clear();
  voice.current = {
    participants: [
      { userId: "u1", name: "Ada", isLocal: true, image: null, isMuted: false },
    ],
  };
  server.resetHandlers();
  server.use(preflight);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CatchUpCard: when it shows", () => {
  it("shows for a meeting more than two minutes old", () => {
    setMeeting(meetingStartedAgo(CATCH_UP_AFTER_MS + 30_000));
    render(<CatchUpCard />);

    expect(screen.getByTestId("catch-up-card")).toBeInTheDocument();
  });

  it("stays hidden for a younger meeting", () => {
    setMeeting(meetingStartedAgo(30_000));
    render(<CatchUpCard />);

    expect(screen.queryByTestId("catch-up-card")).not.toBeInTheDocument();
  });

  it("appears when a young meeting crosses the two minute mark", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    setMeeting(meetingStartedAgo(CATCH_UP_AFTER_MS - 5_000));
    render(<CatchUpCard />);
    expect(screen.queryByTestId("catch-up-card")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.queryByTestId("catch-up-card")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(screen.getByTestId("catch-up-card")).toBeInTheDocument();
  });

  it("renders nothing without a meeting or once it is no longer live", () => {
    setMeeting(null);
    const view = render(<CatchUpCard />);
    expect(screen.queryByTestId("catch-up-card")).not.toBeInTheDocument();

    setMeeting({ ...meetingStartedAgo(600_000), status: "ENDED" });
    view.rerender(<CatchUpCard />);
    expect(screen.queryByTestId("catch-up-card")).not.toBeInTheDocument();
  });
});

describe("CatchUpCard: asking and dismissing", () => {
  beforeEach(() => setMeeting(meetingStartedAgo(5 * 60_000)));

  it("fetches only when asked and shows the bullets", async () => {
    let asked = 0;
    server.use(
      http.get(CATCH_UP, () => {
        asked += 1;
        return ok({
          summary: "- Launch moved to Friday\n- Docs still need review",
          upToSeq: 4,
          generatedAt: null,
          minutesElapsed: 5,
        });
      }),
    );
    render(<CatchUpCard />);
    const user = userEvent.setup();
    expect(asked).toBe(0);

    await user.click(screen.getByRole("button", { name: "Catch me up" }));

    const bullets = await screen.findByTestId("catch-up-bullets");
    expect(bullets).toHaveTextContent("Launch moved to Friday");
    expect(bullets.querySelectorAll("li")).toHaveLength(2);
    expect(bullets).not.toHaveTextContent("- Launch");
    expect(asked).toBe(1);
  });

  it("says when nothing has been said", async () => {
    server.use(answer(null));
    render(<CatchUpCard />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Catch me up" }));

    expect(
      await screen.findByText("Nothing has been said yet."),
    ).toBeInTheDocument();
  });

  it("shows a failure and retries", async () => {
    let hits = 0;
    server.use(
      http.get(CATCH_UP, () => {
        hits += 1;
        return hits === 1
          ? fail(500, "Summary unavailable")
          : ok({
              summary: "- Back",
              upToSeq: 1,
              generatedAt: null,
              minutesElapsed: 5,
            });
      }),
    );
    render(<CatchUpCard />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Catch me up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Summary unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("catch-up-bullets")).toHaveTextContent(
      "Back",
    );
  });

  it("stays dismissed for the meeting, and shows again for the next one", async () => {
    const view = render(<CatchUpCard />);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Dismiss catch me up" }),
    );
    expect(screen.queryByTestId("catch-up-card")).not.toBeInTheDocument();

    view.unmount();
    render(<CatchUpCard />);
    expect(screen.queryByTestId("catch-up-card")).not.toBeInTheDocument();

    window.sessionStorage.clear();
    setMeeting(meetingStartedAgo(5 * 60_000, "m2"));
    view.unmount();
    render(<CatchUpCard />);
    expect(screen.getByTestId("catch-up-card")).toBeInTheDocument();
  });

  it("still dismisses when storage is blocked", async () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    render(<CatchUpCard />);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Dismiss catch me up" }),
    );

    expect(screen.queryByTestId("catch-up-card")).not.toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("Catch me up in the call UI", () => {
  it("is hosted above the captions", () => {
    setMeeting(meetingStartedAgo(5 * 60_000));
    render(<CaptionsBar />);

    const card = screen.getByTestId("catch-up-card");
    const captions = screen.getByTestId("captions");
    expect(
      card.compareDocumentPosition(captions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is absent from the captions bar of a young meeting", () => {
    setMeeting(meetingStartedAgo(10_000));
    render(<CaptionsBar />);

    expect(screen.getByTestId("captions")).toBeInTheDocument();
    expect(screen.queryByTestId("catch-up-card")).not.toBeInTheDocument();
  });

  it("has a button in the transcript panel that shows the summary in place", async () => {
    setMeeting(meetingStartedAgo(10_000));
    server.use(
      answer("- Budget approved\n* Hiring paused\n1. Next sync Monday"),
    );
    render(<LiveTranscript />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Catch me up" }));

    const bullets = await screen.findByTestId("catch-up-bullets");
    await waitFor(() => expect(bullets.querySelectorAll("li")).toHaveLength(3));
    expect(bullets).toHaveTextContent("Next sync Monday");
  });

  it("offers no catch-up in the transcript panel without a meeting", () => {
    setMeeting(null);
    assistant.current.segments = [
      {
        id: "s1",
        meetingId: "m1",
        seq: 1,
        speakerUserId: "u1",
        speakerName: "Ada",
        text: "Hi",
        startMs: 0,
        endMs: 1,
        language: null,
      },
    ];
    render(<LiveTranscript />);

    expect(
      screen.queryByRole("button", { name: "Catch me up" }),
    ).not.toBeInTheDocument();
  });
});

describe("summaryBullets", () => {
  it("strips bullet and list markers and blank lines", () => {
    expect(summaryBullets("- a\n\n* b\n• c\n1) d\n2. e\n  plain")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "plain",
    ]);
  });
});
