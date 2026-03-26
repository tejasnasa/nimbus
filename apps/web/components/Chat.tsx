"use client";

import Button from "@nimbus/ui/Button";
import ChatMsgA from "@nimbus/ui/ChatMsgA";
import ChatMsgB from "@nimbus/ui/ChatMsgB";
import Textarea from "@nimbus/ui/Textarea";
import { useEffect, useRef, useState } from "react";
import { socket } from "../lib/socket";
import { SocketMessage } from "@nimbus/types";

export default function Chat({
  userId,
  messages: initialMessages,
  wsid,
}: {
  userId: string;
  messages: SocketMessage[];
  wsid: string;
}) {
  const [messages, setMessages] = useState<SocketMessage[]>(initialMessages);
  const [content, setContent] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wsid) return;
    socket.emit("workspace:join", wsid);
    return () => {
      socket.emit("workspace:leave", wsid);
    };
  }, [wsid]);

  useEffect(() => {
    function onMessageNew(message: SocketMessage) {
      setMessages((prev) => [...prev, message]);
    }
    socket.on("message:new", onMessageNew);
    return () => {
      socket.off("message:new", onMessageNew);
    };
  }, []);

  // auto scroll to bottom on new messages
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

  return (
    <div className="bg-(--background) h-full min-h-0 rounded-lg flex flex-col justify-between">
      <div className="flex-1 min-h-0 overflow-y-scroll pr-1">
        {messages.map((msg) =>
          msg.userId === userId ? (
            <ChatMsgB
              key={msg.id}
              name={msg.name}
              image={msg.image || ""}
              message={msg.content}
              time={msg.createdAt.toString()}
            />
          ) : (
            <ChatMsgA
              key={msg.id}
              name={msg.name}
              image={msg.image || ""}
              message={msg.content}
              time={msg.createdAt.toString()}
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
