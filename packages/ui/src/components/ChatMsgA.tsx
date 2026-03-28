import Avatar from "./Avatar";

export default function ChatMsgA({
  name,
  image,
  message,
  time,
  isOnline,
}: {
  name: string;
  image: string;
  message: string;
  time: string;
  isOnline?: boolean;
}) {
  return (
    <div className="flex items-center m-2">
      <Avatar
        user={{
          name: name,
          image: image,
          isOnline: isOnline,
        }}
        classname="w-8 h-8 mr-2 self-start"
      />
      <div>
        <div className="text-sm p-1.5 w-fit whitespace-pre-wrap">{message}</div>
        <p className="text-[10px] text-(--muted-foreground) m-px">{time}</p>
      </div>
    </div>
  );
}
