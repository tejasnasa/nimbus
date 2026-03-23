import ChatMsgA from "./ChatMsgA";
import ChatMsgB from "./ChatMsgB";
import Textarea from "./Textarea";

export default function Chat() {
  return (
    <div className="bg-(--background) h-full min-h-0 rounded-lg flex flex-col justify-between">
      <div className="flex-1 min-h-0 overflow-y-scroll pr-1">
        <ChatMsgA
          name="Tejas Nasa"
          image="https://static.vecteezy.com/system/resources/thumbnails/009/292/244/small/default-avatar-icon-of-social-media-user-vector.jpg"
          message="Hi!"
        />
        <ChatMsgB
          name="Jimmy McGill"
          image="https://static.vecteezy.com/system/resources/thumbnails/009/292/244/small/default-avatar-icon-of-social-media-user-vector.jpg"
          message="Hello!"
        />
      </div>

      <div className="w-[95%] mx-auto">
        <Textarea className="text-xs w-full" placeholder="Type..." />
        <p className="text-xs text-(--muted-foreground) mt-1 text-right">
          Ask anything from @NimbusBot
        </p>
      </div>
    </div>
  );
}
