"use client";

import Button from "@nimbus/ui/Button";
import ChatMsgA from "@nimbus/ui/ChatMsgA";
import ChatMsgB from "@nimbus/ui/ChatMsgB";
import Textarea from "@nimbus/ui/Textarea";
import ChatIcon from "@nimbus/ui/icons/Chat";
import { useEffect, useRef, useState } from "react";
import { socket } from "../lib/socket";
import { timeAgo } from "@nimbus/utils";
import { Message } from "@nimbus/types";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";

export default function Chat({
  userId,
  messages: initialMessages,
  wsid,
}: {
  userId: string;
  messages: Message[];
  wsid: string;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [content, setContent] = useState("");
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

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

  function handleSend() {
    if (!content.trim()) return;
    socket.emit("message:send", { workspaceId: wsid, content: content.trim() });
    setContent("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
    <div className="h-full min-h-0 rounded-xl bg-(--background)/50 backdrop-blur-sm border border-(--border) flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-(--border)">
        <div className="w-2 h-2 rounded-full bg-(--chart-2) animate-pulse" />
        <span className="text-xs font-medium text-(--muted-foreground)">
          {onlineUsers.size} online
        </span>
      </div>

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
            />
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-2 pt-0">
        <form className="relative" onSubmit={(e) => e.preventDefault()}>
          <Textarea
            className="text-xs w-full !h-20 rounded-xl !bg-(--muted)/50 pr-16"
            placeholder="Type a message..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
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
