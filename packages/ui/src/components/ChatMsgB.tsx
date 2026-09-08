/**
 * @module ui/components/ChatMsgB
 * @description Right-aligned chat bubble for the current user's own messages:
 * primary-tinted bubble on the right, avatar at the edge. Timestamp reveals
 * on hover. Pair with `ChatMsgA` for incoming messages.
 */
import Avatar from "./Avatar";

/**
 * Outgoing chat message bubble.
 *
 * @param props.name - Current user's display name.
 * @param props.image - Current user's avatar URL.
 * @param props.message - Plain-text content (whitespace preserved).
 * @param props.time - Pre-formatted timestamp, shown on hover.
 * @param props.isOnline - Toggles the avatar presence dot.
 */
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
