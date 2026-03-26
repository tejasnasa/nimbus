"use client";

import { Message } from "@nimbus/types";
import Button from "@nimbus/ui/Button";
import ChatMsgA from "@nimbus/ui/ChatMsgA";
import ChatMsgB from "@nimbus/ui/ChatMsgB";
import Textarea from "@nimbus/ui/Textarea";
import { useEffect } from "react";
import { socket } from "../lib/socket";

export default function Chat({
  userId,
  messages,
  wsid,
}: {
  userId: string;
  messages: Message[];
  wsid: string;
}) {
  useEffect(() => {
    if (!wsid) return;
    socket.emit("workspace:join", wsid);

    return () => {
      socket.emit("workspace:leave", wsid);
    };
  }, [wsid]);

  return (
    <div className="bg-(--background) h-full min-h-0 rounded-lg flex flex-col justify-between">
      <div className="flex-1 min-h-0 overflow-y-scroll pr-1">
        {messages.map((msg) =>
          msg.userId === userId ? (
            <ChatMsgB
              key={msg.id}
              name={msg.user.name}
              image={msg.user.image || ""}
              message={msg.content}
              time={msg.createdAt}
              isOnline={msg.user.isOnline || false}
            />
          ) : (
            <ChatMsgA
              key={msg.id}
              name={msg.user.name}
              image={msg.user.image || ""}
              message={msg.content}
              time={msg.createdAt}
              isOnline={msg.user.isOnline || false}
            />
          ),
        )}
      </div>

      <form className="w-[95%] mx-auto relative">
        <Button
          size="xs"
          className="absolute bottom-6 right-1 m-1 hover:cursor-pointer"
        >
          Send
        </Button>
        <Textarea className="text-xs w-full" placeholder="Type..." />
        <p className="text-xs text-(--muted-foreground) mt-1 text-right">
          Ask anything from @NimbusBot
        </p>
      </form>
    </div>
  );
}
