"use client";

import { Message, Workspace } from "@nimbus/types";
import Button from "@nimbus/ui/Button";
import ChatMsgA from "@nimbus/ui/ChatMsgA";
import ChatMsgB from "@nimbus/ui/ChatMsgB";
import Textarea from "@nimbus/ui/Textarea";
import ChatIcon from "@nimbus/ui/icons/Chat";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { timeAgo } from "@nimbus/utils";
import { useEffect, useRef, useState } from "react";
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
 */
import { useTypingIndicator } from "../hooks/useTypingIndicator";
import { socket } from "../lib/socket";
import TypingIndicator from "./TypingIndicator";
import VoiceControls from "./VoiceControls";

/**
 * @param props.userId - Current user (determines bubble side).
 * @param props.messages - Server-rendered history; live messages append.
 * @param props.wsid - Workspace cuid (socket room).
 * @param props.documents - Passed to VoiceControls for context.
 * @param props.workspaceData - Membership/voice context for VoiceControls.
 */
export default function Chat({
  userId,
  messages: initialMessages,
  wsid,
  documents,
  workspaceData,
}: {
  userId: string;
  messages: Message[];
  wsid: string;
  documents: ClientDocument[];
  workspaceData: Workspace;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [content, setContent] = useState("");
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  function handleSend() {
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

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    // An empty composer is not typing. The hook's idle timer would catch this
    // anyway, but checking here means the network event fires immediately
    // rather than after a 3s wait.
    if (e.target.value === "") {
      stopTyping();
    } else {
      handleTypingInput();
    }
  }

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
        <TypingIndicator names={typingNames} />
        <form className="relative" onSubmit={(e) => e.preventDefault()}>
          <Textarea
            className="text-xs w-full rounded-xl bg-(--muted)/50"
            placeholder="Type a message..."
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={stopTyping}
          />
          <Button
            size="xs"
            onClick={handleSend}
            className="absolute bottom-3 right-2 hover:cursor-pointer rounded-lg"
          >
            Send
          </Button>
        </form>
        <p className="text-[10px] text-(--muted-foreground)/60 mt-1 text-right px-1">
          Ask anything from @NimbusBot
        </p>
      </div>
    </div>
  );
}
