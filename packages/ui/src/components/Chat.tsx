import Button from "./Button";
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
          time="10:00 AM"
        />
        <ChatMsgB
          name="Jimmy McGill"
          image="https://static.vecteezy.com/system/resources/thumbnails/009/292/244/small/default-avatar-icon-of-social-media-user-vector.jpg"
          message="Hello!"
          time="10:05 AM"
        />
        <ChatMsgA
          name="Jimmy McGill"
          image="https://static.vecteezy.com/system/resources/thumbnails/009/292/244/small/default-avatar-icon-of-social-media-user-vector.jpg"
          message="lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.  Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat."
          time="10:05 AM"
        />
        <ChatMsgB
          name="Jimmy McGill"
          image="https://static.vecteezy.com/system/resources/thumbnails/009/292/244/small/default-avatar-icon-of-social-media-user-vector.jpg"
          message="lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.  Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat."
          time="10:05 AM"
        />
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
