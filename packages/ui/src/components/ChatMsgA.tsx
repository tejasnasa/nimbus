/**
 * @module ui/components/ChatMsgA
 * @description Left-aligned chat bubble for other users' (and NimbusBot's)
 * messages: avatar + name on the left, muted bubble underneath. Timestamp
 * reveals on hover. Pair with `ChatMsgB` for the current user's messages.
 */
import type { ReactNode } from "react";
import Avatar from "./Avatar";
import ChatImage from "./ChatImage";

/**
 * Incoming chat message bubble.
 *
 * @param props.name - Sender display name (rendered blue when `isBot`).
 * @param props.image - Sender avatar URL.
 * @param props.message - Plain-text content (whitespace preserved). The text
 *                       bubble is omitted when it is empty and an image is set.
 * @param props.content - Rich replacement for `message` (for example text with
 *                       links); `message` is then only used to decide whether
 *                       the bubble shows.
 * @param props.imageUrl - Attached image, shown as a thumbnail above the text.
 * @param props.time - Pre-formatted timestamp, shown on hover.
 * @param props.isOnline - Toggles the avatar presence dot.
 * @param props.isBot - Highlights the name for bot messages.
 */
export default function ChatMsgA({
  name,
  image,
  message,
  content,
  imageUrl,
  time,
  isOnline,
  isBot,
}: {
  name: string;
  image: string;
  message: string;
  content?: ReactNode;
  imageUrl?: string | null;
  time: string;
  isOnline?: boolean;
  isBot?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 m-1.5 group">
      <Avatar
        user={{
          name: name,
          image: image,
          isOnline: isOnline,
        }}
        classname="w-7 h-7 shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span
            data-testid="chat-msg-name"
            className={`text-[10px] font-medium truncate ${isBot ? "text-blue-500" : "text-(--muted-foreground)/80"}`}
          >
            {name}
          </span>
          <span className="text-[10px] text-(--muted-foreground)/60 opacity-0 group-hover:opacity-100 transition-opacity">
            {time}
          </span>
        </div>
        {imageUrl && <ChatImage url={imageUrl} />}
        {(message || !imageUrl) && (
          <div className="text-xs leading-relaxed px-3 py-1.5 rounded-xl rounded-tl-sm bg-(--muted)/40 w-fit max-w-[85%] whitespace-pre-wrap wrap-break-word">
            {content ?? message}
          </div>
        )}
      </div>
    </div>
  );
}
