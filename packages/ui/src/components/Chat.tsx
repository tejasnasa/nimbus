import { Message } from "@nimbus/types";
import Button from "./Button";
import ChatMsgA from "./ChatMsgA";
import ChatMsgB from "./ChatMsgB";
import Textarea from "./Textarea";

export default function Chat({
  wsid,
  userId,
  messages,
}: {
  wsid: string;
  userId: string;
  messages: Message[];
}) {
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
