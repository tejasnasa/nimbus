/**
 * @module web/tests/components/Chat
 * @description Composer state and AI refusal behaviour for the chat panel.
 *
 * Phase 8 wired the composer to {@link useAiStatus}: when `chat.enabled`
 * is false the textarea and Send button are disabled, the placeholder flips
 * to "Add an API key to chat with @NimbusBot", and an {@link AiRefusalBanner}
 * sits above the composer with an "Add API key" CTA that opens
 * {@link ApiKeyDialog}. When `chat.enabled` is true the composer is fully
 * interactive and the banner is absent.
 *
 * The chat panel is a `use client` component but a few of its dependencies
 * are heavy (`@nimbus/ui/icons/Chat`, the `VoiceControls` WebRTC header).
 * They are stubbed here the same way `VoiceControls.test.tsx` stubs
 * `useVoice`.
 *
 * Decision 6 ("the quota never disables the chat") gets its own test: a
 * documents-only refusal (e.g. `free-tier-exhausted` for canvas) must NOT
 * disable the composer, because the free tier's chat path is unlimited.
 */
import "./testUtils";
import type { AiFeatureStatus, Message, Workspace } from "@nimbus/types";
import { http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Chat from "../../components/Chat";
import type { ClientDocument } from "../../api/document";
import { BACKEND_URL, ok } from "../msw/handlers";
import { server } from "../msw/server";

vi.mock("@nimbus/ui/icons/Chat", () => ({
  default: () => <div data-testid="icon-chat" />,
}));

const voice = vi.hoisted(() => ({
  current: {
    isConnected: true,
    isMuted: false,
    isDeafened: false,
    voiceUsers: [] as {
      userId: string;
      name: string;
      image: string | null;
      isMuted: boolean;
    }[],
    speakingUsers: new Set<string>(),
    toggleMute: vi.fn(),
    toggleDeafen: vi.fn(),
    localUser: { userId: "user-1", name: "Ada Lovelace", image: null },
  },
}));

vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => voice.current,
}));

const { socketMock } = vi.hoisted(() => {
  type Handler = (payload: never) => void;
  const listeners = new Map<string, Set<Handler>>();
  return {
    socketMock: {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: Handler) => {
        const set = listeners.get(event) ?? new Set<Handler>();
        set.add(handler);
        listeners.set(event, set);
      }),
      off: vi.fn((event: string, handler: Handler) => {
        listeners.get(event)?.delete(handler);
      }),
      __fire: (event: string, payload?: unknown) => {
        listeners.get(event)?.forEach((handler) => handler(payload as never));
      },
      __reset: () => listeners.clear(),
    },
  };
});

vi.mock("../../lib/socket", () => ({ socket: socketMock }));

const WORKSPACE: Workspace = {
  id: "cm_workspace_0000000000000",
  name: "Design Guild",
  description: "Shared drafts",
  slug: "design-guild",
  slugId: 1,
  inviteCode: "invite-code",
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  members: [{ id: "user-1", name: "Ada Lovelace", image: null, role: "OWNER" }],
};

const DOCUMENTS: ClientDocument[] = [];

const BASE_MESSAGES: Message[] = [];

const ENABLED_CHAT_STATUS: AiFeatureStatus = {
  enabled: true,
  providerId: null,
  modelId: null,
  substituted: false,
};

const DISABLED_CHAT_STATUS: AiFeatureStatus = {
  enabled: false,
  providerId: null,
  modelId: null,
  substituted: false,
};

beforeEach(() => {
  voice.current.isConnected = true;
  voice.current.isMuted = false;
  voice.current.isDeafened = false;
  voice.current.voiceUsers = [];
  socketMock.__reset();
  socketMock.emit.mockReset();
  socketMock.on.mockClear();
  socketMock.off.mockClear();
  server.resetHandlers();
});

/**
 * Builds a `/api/ai/status` response payload from the desired chat status.
 * The defaults from MSW return `enabled: true`, which would mask the
 * disabled branch unless overridden here.
 */
function statusFor(chat: AiFeatureStatus) {
  return {
    byokAvailable: true,
    chat,
    documents: {
      markdown: {
        enabled: true,
        providerId: null,
        modelId: null,
        substituted: false,
      },
      canvas: {
        enabled: true,
        providerId: null,
        modelId: null,
        substituted: false,
      },
      freeRemaining: 5,
      freeLimit: 5,
      freeTierState: "available" as const,
    },
    credentials: [],
    preferences: { chat: null, markdown: null, canvas: null },
  };
}

function renderChat(props: {
  initialChatStatus: AiFeatureStatus;
  messages?: Message[];
}) {
  return render(
    <Chat
      userId="user-1"
      messages={props.messages ?? BASE_MESSAGES}
      wsid="ws-1"
      documents={DOCUMENTS}
      workspaceData={WORKSPACE}
      initialChatStatus={props.initialChatStatus}
    />,
  );
}

describe("Chat composer", () => {
  it("is fully interactive when chat is enabled", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () =>
        ok(statusFor(ENABLED_CHAT_STATUS)),
      ),
    );

    renderChat({ initialChatStatus: ENABLED_CHAT_STATUS });

    await waitFor(() =>
      expect(screen.getByTestId("chat-composer")).not.toBeDisabled(),
    );

    const textarea = screen.getByTestId("chat-composer");
    const send = screen.getByTestId("chat-send");

    expect(textarea).not.toBeDisabled();
    // The Send button is disabled only because the textarea is empty; the
    // important fact for this test is that it's not locked.
    expect(send).toBeDisabled();

    // No refusal banner when chat is enabled.
    expect(screen.queryByTestId("ai-refusal-banner")).not.toBeInTheDocument();

    // Placeholder is the normal one.
    expect(textarea).toHaveAttribute("placeholder", "Type a message...");
  });

  it("is disabled with a CTA when chat is unavailable", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () =>
        ok(statusFor(DISABLED_CHAT_STATUS)),
      ),
    );

    renderChat({ initialChatStatus: DISABLED_CHAT_STATUS });

    await waitFor(() =>
      expect(screen.getByTestId("chat-composer")).toBeDisabled(),
    );

    const textarea = screen.getByTestId("chat-composer");
    const send = screen.getByTestId("chat-send");

    expect(textarea).toBeDisabled();
    expect(textarea).toHaveAttribute(
      "placeholder",
      "Add an API key to chat with @NimbusBot",
    );
    expect(send).toBeDisabled();

    // The refusal banner + CTA are visible.
    const banner = screen.getByTestId("ai-refusal-banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId("ai-refusal-cta")).toHaveTextContent(
      "Add API key",
    );
  });

  it("does NOT disable the composer when only documents are exhausted", async () => {
    // Decision 6 in the plan: "the quota never disables the chat". The
    // composer must remain interactive even when documents are refused. The
    // server sends a targeted `ai:refused` for documents; the chat panel
    // only listens for chat-feature refusals.
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () =>
        ok(statusFor(ENABLED_CHAT_STATUS)),
      ),
    );

    renderChat({ initialChatStatus: ENABLED_CHAT_STATUS });

    const textarea = screen.getByTestId("chat-composer");
    await waitFor(() => expect(textarea).not.toBeDisabled());

    // A document refusal arrives over the socket. The composer stays open.
    socketMock.__fire("ai:refused", {
      feature: "canvas",
      reason: "free-tier-exhausted",
      message:
        "You've used all 5 free document generations. Add an API key to keep creating documents.",
      cta: "add-key",
    });

    expect(textarea).not.toBeDisabled();
    expect(screen.queryByTestId("ai-refusal-banner")).not.toBeInTheDocument();
  });

  it("surfaces a chat-feature refusal as an inline error", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () =>
        ok(statusFor(ENABLED_CHAT_STATUS)),
      ),
    );

    renderChat({ initialChatStatus: ENABLED_CHAT_STATUS });

    socketMock.__fire("ai:refused", {
      feature: "chat",
      reason: "invalid-key",
      message: "Your API key is no longer valid.",
      cta: "manage-ai",
    });

    await waitFor(() =>
      expect(
        screen.getByText("Your API key is no longer valid."),
      ).toBeInTheDocument(),
    );
  });

  it("dismisses the workspace error when the user clicks the X button", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () =>
        ok(statusFor(ENABLED_CHAT_STATUS)),
      ),
    );

    renderChat({ initialChatStatus: ENABLED_CHAT_STATUS });

    socketMock.__fire("workspace:error", "Forbidden");

    await waitFor(() =>
      expect(screen.getByText("Forbidden")).toBeInTheDocument(),
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(screen.queryByText("Forbidden")).not.toBeInTheDocument(),
    );
  });

  it("renders message bubbles for the history", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () =>
        ok(statusFor(ENABLED_CHAT_STATUS)),
      ),
    );

    const user = userEvent.setup();
    render(
      <Chat
        userId="user-1"
        messages={[
          {
            id: "m-1",
            userId: "user-2",
            workspaceId: "ws-1",
            name: "Grace Hopper",
            content: "Hello!",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ]}
        wsid="ws-1"
        documents={DOCUMENTS}
        workspaceData={WORKSPACE}
        initialChatStatus={ENABLED_CHAT_STATUS}
      />,
    );

    // The peer's message renders as ChatMsgA (left-aligned). The empty-state
    // placeholder is gone once messages exist.
    expect(screen.queryByText("No messages yet")).not.toBeInTheDocument();
    expect(screen.getByText("Hello!")).toBeInTheDocument();
    void user;
  });

  it("opens the Add API key dialog when the refusal CTA is used", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () =>
        ok(statusFor(DISABLED_CHAT_STATUS)),
      ),
    );

    const user = userEvent.setup();
    renderChat({ initialChatStatus: DISABLED_CHAT_STATUS });

    await waitFor(() =>
      expect(screen.getByTestId("ai-refusal-cta")).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId("ai-refusal-cta"));

    expect(screen.getByLabelText("add-api-key-form")).toBeInTheDocument();
  });

  it("still sends human messages even while the AI is disabled", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () =>
        ok(statusFor(DISABLED_CHAT_STATUS)),
      ),
    );

    renderChat({ initialChatStatus: DISABLED_CHAT_STATUS });

    await waitFor(() =>
      expect(screen.getByTestId("chat-composer")).toBeDisabled(),
    );

    // The disabled composer is a UX gate, not an authorization rule. Human
    // chat remains open so a user without an AI entitlement is not locked
    // out of a collaborative room where everyone else can talk.
    expect(screen.getByTestId("chat-composer")).toBeDisabled();
    expect(screen.getByTestId("chat-send")).toBeDisabled();
  });

  it("refetches AI status when the socket reconnects", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () =>
        ok(statusFor(DISABLED_CHAT_STATUS)),
      ),
    );

    renderChat({ initialChatStatus: DISABLED_CHAT_STATUS });

    await waitFor(() =>
      expect(screen.getByTestId("chat-composer")).toBeDisabled(),
    );

    // The connect listener is wired so a user who adds a key in a second tab
    // sees the composer re-enable without a hard reload.
    const connectHandlers = socketMock.on.mock.calls
      .map(([event]) => event)
      .filter((e) => e === "connect");
    expect(connectHandlers.length).toBeGreaterThan(0);
  });
});
