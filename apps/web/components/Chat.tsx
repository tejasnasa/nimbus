"use client";

import Button from "@nimbus/ui/Button";
import ChatMsgA from "@nimbus/ui/ChatMsgA";
import ChatMsgB from "@nimbus/ui/ChatMsgB";
import Textarea from "@nimbus/ui/Textarea";
import { useEffect, useRef, useState } from "react";
import { socket } from "../lib/socket";
import {  timeAgo } from "@nimbus/utils";
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
    <div className="bg-(--background) h-full min-h-0 rounded-lg flex flex-col justify-between">
      <div className="flex-1 min-h-0 overflow-y-scroll pr-1">
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
      <form className="w-[95%] mx-auto relative">
        <Button
          size="xs"
          onClick={handleSend}
          className="absolute bottom-6 right-1 m-1 hover:cursor-pointer"
        >
          Send
        </Button>
        <Textarea
          className="text-xs w-full"
          placeholder="Type..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <p className="text-xs text-(--muted-foreground) mt-1 text-right">
          Ask anything from @NimbusBot
        </p>
      </form>
    </div>
  );
}
