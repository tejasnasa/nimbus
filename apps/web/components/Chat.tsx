"use client";

import { AiWorkspaceStatusDTO, Message } from "@nimbus/types";
import Button from "@nimbus/ui/Button";
import ChatMsgA from "@nimbus/ui/ChatMsgA";
import ChatMsgB from "@nimbus/ui/ChatMsgB";
import Textarea from "@nimbus/ui/Textarea";
import ChatIcon from "@nimbus/ui/icons/Chat";
import PaperclipIcon from "@nimbus/ui/icons/Paperclip";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { timeAgo } from "@nimbus/utils";
import { useCallback, useEffect, useRef, useState } from "react";
/**
 * @module web/components/Chat
 * @description Workspace chat panel: joins/leaves the workspace room,
 * appends `message:new` live, tracks `presence:*` for online dots, surfaces a
 * refused join (`workspace:error`) as a dismissible banner, and auto-scrolls on
 * new messages. Own messages render right (`ChatMsgB`), others/bot left
 * (`ChatMsgA`); Enter sends, Shift+Enter newlines. Typing indicators are
 * wired through `useTypingIndicator` so the composer emits throttled
 * `typing:start`/`typing:stop` events and renders peers' status as a
 * reserved-height line below the message list; NimbusBot appears there as a
 * typer while the server's `bot:typing` signal (`useBotTyping`) is on.
 *
 * Images: the paperclip (or a file dropped on the composer) uploads straight to
 * Cloudinary through `useChatImageUpload`, showing a progress chip that can be
 * cancelled; once ready, Send posts the message with its `imageUrl` (the text
 * may be empty). Messages with an image render a thumbnail that opens full size.
 *
 * A message from someone else that contains `[label](nimbus-doc:<id>)` (the
 * notes link NimbusBot posts when a meeting is written up) shows the label as a
 * button that opens the document through `useOpenDocument`. The workspace
 * settings dialog is not rendered here: this panel asks the shared
 * `WorkspaceSettingsProvider` to open it on the AI tab.
 *
 * The composer **disables** when `features.chat.enabled === false` and renders
 * an {@link AiRefusalBanner}. Keys belong to the workspace, so an admin gets an
 * Add API key button (or, for a spent monthly cap, a button that opens the
 * workspace's AI settings) and a member is told to ask a workspace admin. The
 * disabled composer is a
 * UX gate, not an authorization rule — `message:send` still accepts a human
 * message from this user, because disabling it would lock a user without an
 * AI entitlement out of a collaborative room where everyone else can talk.
 * The AI refusal is enforced where it belongs: at the AI call.
 *
 * @important Do not "fix" the disabled-but-still-sends design. The plan
 *            (§10) is explicit that human chat remains open, and the comment
 *            lives here so a future reader does not mistake it for a bug.
 */
import {
  CHAT_IMAGE_ACCEPT,
  useChatImageUpload,
} from "../hooks/useChatImageUpload";
import { useOpenDocument } from "../hooks/useOpenDocument";
import { useBotTyping } from "../hooks/useBotTyping";
import { useTypingIndicator } from "../hooks/useTypingIndicator";
import { useWorkspaceAiStatus } from "../hooks/useWorkspaceAiStatus";
import { aiApi, workspaceAiPath } from "../lib/aiApi";
import { chatTimeContext } from "../lib/chatClock";
import { socket } from "../lib/socket";
import AiRefusalBanner from "./AiRefusalBanner";
import ApiKeyDialog from "./ApiKeyDialog";
import TypingIndicator from "./TypingIndicator";
import ChatMessageText, { hasDocLink } from "./ChatMessageText";
import { useWorkspaceSettings } from "./WorkspaceSettingsContext";

/**
 * @param props.userId - Current user (determines bubble side).
 * @param props.messages - Server-rendered history; live messages append.
 * @param props.wsid - Workspace cuid (socket room).
 * @param props.initialAiStatus - Server-fetched workspace AI status so the
 *                                composer renders in the right state before
 *                                `useWorkspaceAiStatus` lands.
 */
export default function Chat({
  userId,
  messages: initialMessages,
  wsid,
  initialAiStatus,
}: {
  userId: string;
  messages: Message[];
  wsid: string;
  initialAiStatus: AiWorkspaceStatusDTO;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [content, setContent] = useState("");
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [aiRefusal, setAiRefusal] = useState<{
    message: string;
    cta: "add-key" | "manage-ai" | null;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const settings = useWorkspaceSettings();
  const openDocument = useOpenDocument();
  const bottomRef = useRef<HTMLDivElement>(null);

  const { state: aiState, refresh: refreshAiStatus } =
    useWorkspaceAiStatus(wsid);
  // Seed with the server-rendered status; switch to the live payload once the
  // hook's fetch lands.
  const aiStatus: AiWorkspaceStatusDTO =
    aiState.kind === "ready" ? aiState.status : initialAiStatus;
  const chatStatus = aiStatus.features.chat;
  const chatEnabled = chatStatus.enabled;
  const canManageAi = aiStatus.canManage;
  const capReached = chatStatus.reason === "spend-cap-reached";

  // Throttled outbound + debounced inbound typing. The hook owns every timer
  // and clears them on unmount, so the composer never has to.
  const imageUpload = useChatImageUpload(wsid);
  const pendingImage = imageUpload.state;

  const { typingNames, handleTypingInput, stopTyping } = useTypingIndicator({
    wsid,
    currentUserId: userId,
  });

  const botTyping = useBotTyping(wsid);

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
      // The chat composer cares about chat refusals, and about a vision
      // refusal (the bot could not read an image). Document refusals are
      // surfaced by the doc editor's own overlay.
      if (data.feature === "vision") {
        setAiRefusal({ message: data.message, cta: data.cta });
        return;
      }
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
    const imageUrl =
      pendingImage.status === "ready" ? pendingImage.imageUrl : undefined;
    if (pendingImage.status === "uploading") return;
    if (!content.trim() && !imageUrl) return;
    socket.emit("message:send", {
      workspaceId: wsid,
      content: content.trim(),
      ...(imageUrl ? { imageUrl } : {}),
      ...chatTimeContext(),
    });
    setContent("");
    imageUpload.reset();
    // Sending also stops typing — the composer is empty, and a sent message
    // is a clear "I'm done" signal.
    stopTyping();
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || !chatEnabled) return;
    void imageUpload.upload(file);
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
  // AI status so the composer re-enables without a hard reload, and close the
  // dialog. Failures surface inline in the dialog itself.
  const handleSaveApiKey = async (input: {
    providerId: string;
    apiKey: string;
    label?: string;
  }) => {
    const result = await aiApi(
      workspaceAiPath(wsid, "/credentials"),
      { method: "POST", body: input },
      "Could not save the credential. Please try again.",
    );
    if (!result.ok) return { ok: false as const, message: result.message };
    await refreshAiStatus();
    setAiDialogOpen(false);
    return { ok: true as const };
  };

  // A link in a message (the meeting notes NimbusBot posts) opens that document
  // in the editor; a failure is said in the same banner as other room errors.
  const handleOpenDocument = (documentId: string) => {
    void openDocument.open(documentId).then((opened) => {
      if (!opened) setWorkspaceError("That document could not be opened.");
    });
  };

  const placeholder = chatEnabled
    ? "Type a message..."
    : canManageAi
      ? "Add an API key to chat with @NimbusBot"
      : "@NimbusBot is unavailable in this workspace";

  return (
    <div className="h-full min-h-0 rounded-xl bg-(--background)/50 backdrop-blur-sm border border-(--border) flex flex-col overflow-hidden">
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

      {aiRefusal && (
        <div
          role="alert"
          data-testid="vision-refusal"
          className="mx-2 mt-2 flex items-start justify-between gap-2 rounded-lg border border-(--border) bg-(--muted)/40 px-3 py-2 text-xs"
        >
          <span>{aiRefusal.message}</span>
          <span className="flex shrink-0 items-center gap-2">
            {aiRefusal.cta === "manage-ai" && canManageAi && (
              <button
                type="button"
                onClick={() => {
                  settings.open("AI");
                  setAiRefusal(null);
                }}
                className="hover:cursor-pointer underline"
              >
                AI settings
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setAiRefusal(null)}
              className="hover:cursor-pointer text-(--muted-foreground)"
            >
              ×
            </button>
          </span>
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
              imageUrl={msg.imageUrl}
              time={timeAgo(msg.createdAt)}
            />
          ) : (
            <ChatMsgA
              key={msg.id}
              name={msg.name}
              image={msg.image || getAvatarForUser(msg.userId)}
              message={msg.content}
              content={
                hasDocLink(msg.content) ? (
                  <ChatMessageText
                    text={msg.content}
                    onOpenDocument={handleOpenDocument}
                  />
                ) : undefined
              }
              imageUrl={msg.imageUrl}
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
            message={
              capReached
                ? "This workspace has reached its monthly AI spend cap."
                : "This workspace has no AI key yet, so @NimbusBot cannot reply."
            }
            cta={capReached ? "manage-ai" : "add-key"}
            reason={chatStatus.reason}
            canManage={canManageAi}
            onCtaClickAction={() =>
              capReached ? settings.open("AI") : setAiDialogOpen(true)
            }
            ctaDisabled={aiDialogOpen}
          />
        )}
        <TypingIndicator
          names={botTyping ? [...typingNames, "NimbusBot"] : typingNames}
        />
        {pendingImage.status !== "idle" && pendingImage.status !== "error" && (
          <div
            data-testid="chat-image-pending"
            className="mb-1 flex items-center gap-2 rounded-lg border border-(--border) bg-(--muted)/40 p-1.5"
          >
            {/* A blob: preview of a local file; next/image cannot optimise it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pendingImage.previewUrl}
              alt="Selected image"
              className="h-10 w-10 rounded object-cover"
            />
            <div className="min-w-0 flex-1 text-[10px] text-(--muted-foreground)">
              {pendingImage.status === "uploading" ? (
                <>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pendingImage.progress}
                    className="h-1.5 w-full overflow-hidden rounded bg-(--muted)"
                  >
                    <div
                      className="h-full bg-(--primary)"
                      style={{ width: `${pendingImage.progress}%` }}
                    />
                  </div>
                  <span>Uploading… {pendingImage.progress}%</span>
                </>
              ) : (
                <span>Image ready to send</span>
              )}
            </div>
            <button
              type="button"
              aria-label="Remove image"
              data-testid="chat-image-cancel"
              onClick={imageUpload.cancel}
              className="shrink-0 hover:cursor-pointer text-(--muted-foreground)"
            >
              ×
            </button>
          </div>
        )}
        {pendingImage.status === "error" && (
          <div
            role="alert"
            data-testid="chat-image-error"
            className="mb-1 flex items-start justify-between gap-2 rounded-lg border border-(--destructive)/40 bg-(--destructive)/10 px-2 py-1 text-[10px] text-(--destructive)"
          >
            <span>{pendingImage.message}</span>
            <button
              type="button"
              aria-label="Dismiss image error"
              onClick={imageUpload.reset}
              className="shrink-0 hover:cursor-pointer"
            >
              ×
            </button>
          </div>
        )}
        <form
          className={`relative rounded-xl ${dragging ? "ring-2 ring-(--primary)" : ""}`}
          onSubmit={(e) => e.preventDefault()}
          data-testid="chat-dropzone"
          onDragOver={(e) => {
            if (!chatEnabled) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={CHAT_IMAGE_ACCEPT}
            className="hidden"
            data-testid="chat-image-input"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label="Attach image"
            data-testid="chat-attach"
            disabled={!chatEnabled}
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
            className="absolute bottom-3 left-2 z-10 grid h-7 w-7 place-items-center rounded-lg border border-(--border) bg-(--card) text-(--muted-foreground) shadow-sm transition-colors hover:cursor-pointer hover:text-(--foreground) hover:bg-(--muted) disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PaperclipIcon className="h-4 w-4" />
          </button>
          <Textarea
            className="text-xs w-full rounded-xl bg-(--muted)/50 pb-12"
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
            disabled={
              !chatEnabled ||
              pendingImage.status === "uploading" ||
              (!content.trim() && pendingImage.status !== "ready")
            }
            data-testid="chat-send"
            className="absolute bottom-3 right-2 hover:cursor-pointer rounded-lg"
          >
            Send
          </Button>
        </form>
        <p className="text-[10px] text-(--muted-foreground)/60 mt-1 text-right px-1">
          {chatEnabled
            ? "Ask anything from @NimbusBot"
            : canManageAi
              ? "Add an API key to enable AI replies"
              : "AI replies are unavailable here"}
        </p>
      </div>

      {canManageAi && (
        <ApiKeyDialog
          open={aiDialogOpen}
          onOpenChange={setAiDialogOpen}
          onSave={handleSaveApiKey}
        />
      )}
    </div>
  );
}
