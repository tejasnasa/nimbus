import Avatar from "./Avatar";

export default function ChatMsgA({
  name,
  image,
  message,
  time,
}: {
  name: string;
  image: string;
  message: string;
  time: string;
}) {
  return (
    <div className="flex items-center m-2">
      <Avatar
        user={{
          name: name,
          image: image,
        }}
        classname="w-8 h-8 mr-2 self-start"
      />
      <div>
        <div className="text-sm bg-(--card) p-1.5 w-fit rounded-md">
          {message}
        </div>
        <p className="text-[10px] text-(--muted-foreground) m-px">{time}</p>
      </div>
    </div>
  );
}
