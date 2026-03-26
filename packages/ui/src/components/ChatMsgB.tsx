import Avatar from "./Avatar";

export default function ChatMsgB({
  name,
  image,
  message,
  time,
  isOnline
}: {
  name: string;
  image: string;
  message: string;
  time: string;
  isOnline?: boolean;
}) {
  return (
    <div className="flex items-center justify-end m-2">
      <div className="flex flex-col items-end">
        <div className="text-sm p-1.5 w-fit rounded-md border border-(--border)">
          {message}
        </div>
        <p className="text-[10px] text-(--muted-foreground) m-px">{time}</p>
      </div>
      <Avatar
        user={{
          name: name,
          image: image,
          isOnline: isOnline,
        }}
        classname="w-8 h-8 ml-2 self-start"
      />
    </div>
  );
}
