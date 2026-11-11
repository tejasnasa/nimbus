/**
 * @module web/tests/components/ChatBotTyping
 * @description The "NimbusBot is typing…" line above the composer: on with the
 * server's `bot:typing` signal, off when the signal ends, when a message from
 * the bot arrives, or after the safety timeout; scoped to its own workspace and
 * announced politely to assistive technology.
 */
import "./testUtils";
import type { Message } from "@nimbus/types";
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientDocument } from "../../api/document";
import Chat from "../../components/Chat";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";
import { WorkspaceSettingsProvider } from "../../components/WorkspaceSettingsContext";
import { BOT_TYPING_SAFETY_MS, useBotTyping } from "../../hooks/useBotTyping";
import { aiStatus } from "../msw/aiFixtures";
import { workspace } from "../msw/meetingFixtures";
import { fakeSocket } from "./fakeSocket";

vi.mock(
  "../../lib/socket",
  async () => (await import("./fakeSocket")).socketModule,
);
vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => ({
    isConnected: false,
    isMuted: false,
    isDeafened: false,
    voiceUsers: [],
    participants: [],
    speakingUsers: new Set<string>(),
    toggleMute: vi.fn(),
    toggleDeafen: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    isJoining: false,
    connectionState: "disconnected",
    error: null,
    canRejoin: false,
    localUser: { userId: "user-1", name: "Ada", image: null },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/workspace/1",
  useParams: () => ({ slugId: "1" }),
  useSearchParams: () => new URLSearchParams(),
}));

const BOT = "bot-user-id";
const WS = "ws-1";
const DOCUMENTS: ClientDocument[] = [];

const typing = (value: boolean, workspaceId = WS) =>
  act(() => fakeSocket.fire("bot:typing", { workspaceId, typing: value }));

const botMessage = (): Message =>
  ({
    id: "m1",
    content: "hi",
    userId: BOT,
    workspaceId: WS,
    createdAt: new Date().toISOString(),
    name: "NimbusBot",
    image: null,
  }) as unknown as Message;

beforeEach(() => {
  fakeSocket.reset();
  process.env.NEXT_PUBLIC_BOT_USERID = BOT;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useBotTyping", () => {
  it("follows the signal for its own workspace only", () => {
    const { result } = renderHook(() => useBotTyping(WS));
    expect(result.current).toBe(false);

    typing(true, "another-workspace");
    expect(result.current).toBe(false);

    typing(true);
    expect(result.current).toBe(true);

    typing(false);
    expect(result.current).toBe(false);
  });

  it("clears when a message from the bot arrives, but not for anyone else", () => {
    const { result } = renderHook(() => useBotTyping(WS));
    typing(true);

    act(() => fakeSocket.fire("message:new", { userId: "someone-else" }));
    expect(result.current).toBe(true);

    act(() => fakeSocket.fire("message:new", botMessage()));
    expect(result.current).toBe(false);
  });

  it("clears itself after the safety timeout if nothing ends it", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useBotTyping(WS));
    typing(true);

    act(() => vi.advanceTimersByTime(BOT_TYPING_SAFETY_MS - 1));
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it("restarts the timeout on a repeated signal and stops listening on unmount", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useBotTyping(WS));
    typing(true);
    act(() => vi.advanceTimersByTime(BOT_TYPING_SAFETY_MS - 1000));
    typing(true);
    act(() => vi.advanceTimersByTime(BOT_TYPING_SAFETY_MS - 1000));
    expect(result.current).toBe(true);

    unmount();
    expect(fakeSocket.listenerCount("bot:typing")).toBe(0);
    expect(fakeSocket.listenerCount("message:new")).toBe(0);
  });
});

describe("Chat: NimbusBot typing line", () => {
  const renderChat = () =>
    render(
      <DocEditorRefProvider>
        <WorkspaceSettingsProvider
          workspace={workspace}
          documents={DOCUMENTS}
          initialAiStatus={aiStatus()}
          userId="user-1"
        >
          <Chat
            userId="user-1"
            messages={[]}
            wsid={WS}
            initialAiStatus={aiStatus()}
          />
        </WorkspaceSettingsProvider>
      </DocEditorRefProvider>,
    );

  it("shows the line in a polite status region while the bot is typing", () => {
    renderChat();
    expect(screen.queryByText("NimbusBot is typing…")).not.toBeInTheDocument();

    typing(true);

    const line = screen.getByText("NimbusBot is typing…");
    const region = line.closest("[role='status']");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region?.querySelectorAll(".animate-pulse")).toHaveLength(3);

    typing(false);
    expect(screen.queryByText("NimbusBot is typing…")).not.toBeInTheDocument();
  });

  it("hides the line when the bot's message arrives", () => {
    renderChat();
    typing(true);

    act(() => fakeSocket.fire("message:new", botMessage()));

    expect(screen.queryByText("NimbusBot is typing…")).not.toBeInTheDocument();
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  it("names the bot alongside a member who is typing", () => {
    renderChat();

    act(() =>
      fakeSocket.fire("typing:start", { userId: "user-2", name: "Grace" }),
    );
    typing(true);

    expect(
      screen.getByText("Grace and NimbusBot are typing…"),
    ).toBeInTheDocument();
  });
});
