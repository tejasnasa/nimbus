import Avatar from "./Avatar";

export default function ChatMsgB({
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
    <div className="flex items-start gap-2 m-1.5 justify-end group">
      <div className="flex-1 min-w-0 flex flex-col items-end">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[10px] text-(--muted-foreground)/60 opacity-0 group-hover:opacity-100 transition-opacity">
            {time}
          </span>
          <span className="text-xs font-medium truncate text-(--muted-foreground)/80">
            {name}
          </span>
        </div>
        <div className="text-sm leading-relaxed px-3 py-1.5 rounded-xl rounded-tr-sm bg-(--primary)/15 w-fit max-w-[85%] whitespace-pre-wrap break-words">
          {message}
        </div>
      </div>
      <Avatar
        user={{
          name: name,
          image: image,
          isOnline: isOnline,
        }}
        classname="w-7 h-7 shrink-0 mt-0.5"
      />
    </div>
  );
}
