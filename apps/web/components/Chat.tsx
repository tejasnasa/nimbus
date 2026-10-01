"use client";

import { AiFeatureStatus, Message, Workspace } from "@nimbus/types";
import Button from "@nimbus/ui/Button";
import ChatMsgA from "@nimbus/ui/ChatMsgA";
import ChatMsgB from "@nimbus/ui/ChatMsgB";
import Textarea from "@nimbus/ui/Textarea";
import ChatIcon from "@nimbus/ui/icons/Chat";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { timeAgo } from "@nimbus/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClientDocument } from "../api/document";
/**
 * @module web/components/Chat
 * @description Workspace chat panel: joins/leaves the workspace room,
 * appends `message:new` live, tracks `presence:*` for online dots, surfaces a
 * refused join (`workspace:error`) as a dismissible banner, and auto-scrolls on
 * new messages. Own messages render right (`ChatMsgB`), others/bot left
 * (`ChatMsgA`); Enter sends, Shift+Enter newlines. Typing indicators are
 * wired through `useTypingIndicator` so the composer emits throttled
 * `typing:start`/`typing:stop` events and renders peers' status as a
 * reserved-height line below the message list.
 *
 * The composer **disables** when `chat.enabled === false` and renders an
 * {@link AiRefusalBanner} + an Add API key CTA. The disabled composer is a
 * UX gate, not an authorization rule — `message:send` still accepts a human
 * message from this user, because disabling it would lock a user without an
 * AI entitlement out of a collaborative room where everyone else can talk.
 * The AI refusal is enforced where it belongs: at the AI call.
 *
 * @important Do not "fix" the disabled-but-still-sends design. The plan
 *            (§10) is explicit that human chat remains open, and the comment
 *            lives here so a future reader does not mistake it for a bug.
 */
import { useTypingIndicator } from "../hooks/useTypingIndicator";
import { useAiStatus } from "../hooks/useAiStatus";
import { socket } from "../lib/socket";
import AiRefusalBanner from "./AiRefusalBanner";
import ApiKeyDialog from "./ApiKeyDialog";
import TypingIndicator from "./TypingIndicator";
import VoiceControls from "./VoiceControls";

/**
 * @param props.userId - Current user (determines bubble side).
 * @param props.messages - Server-rendered history; live messages append.
 * @param props.wsid - Workspace cuid (socket room).
 * @param props.documents - Passed to to VoiceControls for context.
 * @param props.workspaceData - Membership/voice context for VoiceControls.
 * @param props.initialChatStatus - Server-fetched chat feature status so the
 *                                  composer renders in the right state before
 *                                  `useAiStatus` lands.
 */
export default function Chat({
  userId,
  messages: initialMessages,
  wsid,
  documents,
  workspaceData,
  initialChatStatus,
}: {
  userId: string;
  messages: Message[];
  wsid: string;
  documents: ClientDocument[];
  workspaceData: Workspace;
  initialChatStatus: AiFeatureStatus;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [content, setContent] = useState("");
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { state: aiState, refresh: refreshAiStatus } = useAiStatus();
  // Seed with the server-rendered status; switch to the live payload once the
  // hook's fetch lands.
  const chatStatus: AiFeatureStatus =
    aiState.kind === "ready" ? aiState.status.chat : initialChatStatus;
  const chatEnabled = chatStatus.enabled;

  // Throttled outbound + debounced inbound typing. The hook owns every timer
  // and clears them on unmount, so the composer never has to.
  const { typingNames, handleTypingInput, stopTyping } = useTypingIndicator({
    wsid,
    currentUserId: userId,
  });

  useEffect(() => {
    if (!wsid) return;
    socket.emit("workspace:join", wsid);
    return () => {
      socket.emit("workspace:leave", wsid);
    };
  }, [wsid]);

  useEffect(() => {
    function onMessageNew(message: Message) {
      setMessages((prev) => [...prev, message]);
    }
    socket.on("message:new", onMessageNew);
    return () => {
      socket.off("message:new", onMessageNew);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // A refused workspace join otherwise leaves the panel connected but inert —
  // no messages, no presence, and nothing to distinguish it from a slow load.
  useEffect(() => {
    function onWorkspaceError(message: string) {
      setWorkspaceError(message);
    }
    socket.on("workspace:error", onWorkspaceError);
    return () => {
      socket.off("workspace:error", onWorkspaceError);
    };
  }, []);

  // Targeted AI refusals (e.g. quota exhausted) come over `ai:refused` and
  // are emitted only to the asking socket — the plan is explicit that they
  // must not broadcast.
  useEffect(() => {
    function onAiRefused(data: {
      feature: string;
      reason: string;
      message: string;
      cta: "add-key" | "manage-ai" | null;
    }) {
      // The chat composer only cares about chat refusals. Document refusals
      // are surfaced by the doc editor's own overlay.
      if (data.feature !== "chat") return;
      setWorkspaceError(data.message);
    }
    socket.on("ai:refused", onAiRefused);
    return () => {
      socket.off("ai:refused", onAiRefused);
    };
  }, []);

  // Refetch the AI status whenever the socket reconnects, so a user who
  // added a key in a second tab sees the composer re-enable without a hard
  // reload.
  useEffect(() => {
    function onConnect() {
      void refreshAiStatus();
    }
    socket.on("connect", onConnect);
    return () => {
      socket.off("connect", onConnect);
    };
  }, [refreshAiStatus]);

  function handleSend() {
    // Disabled composer guard — defends against a programmatic submit, a stale
    // closure, or an Enter keydown slipping past the textarea's `disabled`.
    if (!chatEnabled) return;
    if (!content.trim()) return;
    socket.emit("message:send", {
      workspaceId: wsid,
      content: content.trim(),
    });
    setContent("");
    // Sending also stops typing — the composer is empty, and a sent message
    // is a clear "I'm done" signal.
    stopTyping();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      // Same guard as handleSend: a keystroke must not move the composer into
      // a typing state for a user who cannot chat.
      if (!chatEnabled) return;
      setContent(e.target.value);
      // An empty composer is not typing. The hook's idle timer would catch this
      // anyway, but checking here means the network event fires immediately
      // rather than after a 3s wait.
      if (e.target.value === "") {
        stopTyping();
      } else {
        handleTypingInput();
      }
    },
    [chatEnabled, handleTypingInput, stopTyping],
  );

  useEffect(() => {
    function onOnlineUsers(userIds: string[]) {
      setOnlineUsers(new Set(userIds));
    }
    function onPresenceJoined({ userId }: { userId: string }) {
      setOnlineUsers((prev) => new Set([...prev, userId]));
    }
    function onPresenceLeft({ userId }: { userId: string }) {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }

    socket.on("presence:online_users", onOnlineUsers);
    socket.on("presence:joined", onPresenceJoined);
    socket.on("presence:left", onPresenceLeft);

    return () => {
      socket.off("presence:online_users", onOnlineUsers);
      socket.off("presence:joined", onPresenceJoined);
      socket.off("presence:left", onPresenceLeft);
    };
  }, []);

  // The save handler for the Add API key dialog. Saving succeeds → refresh
  // AI status so the composer re-enables without a hard reload. Failures
  // surface inline in the dialog itself.
  const handleSaveApiKey = async (input: {
    providerId: string;
    apiKey: string;
    label?: string;
  }) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ai/credentials`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify(input),
        },
      );
      const body = (await res.json()) as {
        success: boolean;
        message?: string;
      };
      if (!res.ok || !body.success) {
        return {
          ok: false as const,
          message:
            body.message ?? "Could not save the credential. Please try again.",
        };
      }
      await refreshAiStatus();
      return { ok: true as const };
    } catch (err) {
      return {
        ok: false as const,
        message:
          (err as { message?: string }).message ??
          "Could not save the credential. Please try again.",
      };
    }
  };

  const placeholder = chatEnabled
    ? "Type a message..."
    : "Add an API key to chat with @NimbusBot";

  return (
    <div className="h-full min-h-0 rounded-xl bg-(--background)/50 backdrop-blur-sm border border-(--border) flex flex-col overflow-hidden">
      <VoiceControls workspaceData={workspaceData} documents={documents} />

      {workspaceError && (
        <div
          role="alert"
          className="mx-2 mt-2 flex items-start justify-between gap-2 rounded-lg border border-(--destructive)/40 bg-(--destructive)/10 px-3 py-2 text-xs text-(--destructive)"
        >
          <span>{workspaceError}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setWorkspaceError(null)}
            className="shrink-0 hover:cursor-pointer text-(--muted-foreground)"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-12 h-12 rounded-2xl bg-(--primary)/10 flex items-center justify-center mb-3">
              <ChatIcon className="w-6 h-6 text-(--primary)" />
            </div>
            <p className="text-sm text-(--muted-foreground)">No messages yet</p>
            <p className="text-xs text-(--muted-foreground)/60 mt-1">
              Start the conversation
            </p>
          </div>
        )}
        {messages.map((msg) =>
          msg.userId === userId ? (
            <ChatMsgB
              key={msg.id}
              name={msg.name}
              image={msg.image || getAvatarForUser(msg.userId)}
              message={msg.content}
              time={timeAgo(msg.createdAt)}
            />
          ) : (
            <ChatMsgA
              key={msg.id}
              name={msg.name}
              image={msg.image || getAvatarForUser(msg.userId)}
              message={msg.content}
              time={timeAgo(msg.createdAt)}
              isOnline={onlineUsers.has(msg.userId)}
              isBot={msg.userId === process.env.NEXT_PUBLIC_BOT_USERID}
            />
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-2 pt-0">
        {!chatEnabled && (
          <AiRefusalBanner
            message="Add your API key to chat with @NimbusBot."
            cta="add-key"
            onCtaClickAction={() => setAiDialogOpen(true)}
            ctaDisabled={aiDialogOpen}
          />
        )}
        <TypingIndicator names={typingNames} />
        <form className="relative" onSubmit={(e) => e.preventDefault()}>
          <Textarea
            className="text-xs w-full rounded-xl bg-(--muted)/50"
            placeholder={placeholder}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={stopTyping}
            disabled={!chatEnabled}
            aria-disabled={!chatEnabled}
            data-testid="chat-composer"
          />
          <Button
            size="xs"
            onClick={handleSend}
            disabled={!chatEnabled || !content.trim()}
            data-testid="chat-send"
            className="absolute bottom-3 right-2 hover:cursor-pointer rounded-lg"
          >
            Send
          </Button>
        </form>
        <p className="text-[10px] text-(--muted-foreground)/60 mt-1 text-right px-1">
          {chatEnabled
            ? "Ask anything from @NimbusBot"
            : "Add an API key to enable AI replies"}
        </p>
      </div>

      <ApiKeyDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        onSave={handleSaveApiKey}
      />
    </div>
  );
}
