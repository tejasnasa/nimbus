/**
 * @module ui/components/ChatMsgB
 * @description Chat row for the current user's own messages. It shares the
 * layout of `ChatMsgA` (rounded square avatar, name, time, text), with the name
 * in the violet accent and `@nimbus` mentions picked out. Pair with `ChatMsgA`
 * for incoming messages.
 */
import { BOT_MENTION } from "@nimbus/types";
import Avatar from "./Avatar";
import ChatImage from "./ChatImage";

const MENTION = new RegExp(`(${BOT_MENTION.source})`, "gi");

function HighlightMentions({ text }: { text: string }) {
  return (
    <>
      {text.split(MENTION).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-semibold text-(--violet-soft)">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * Outgoing chat message.
 *
 * @param props.name - Current user's display name.
 * @param props.image - Current user's avatar URL.
 * @param props.message - Plain-text content (whitespace preserved). The text
 *                       is omitted when it is empty and an image is set.
 * @param props.imageUrl - Attached image, shown as a thumbnail above the text.
 * @param props.time - Pre-formatted timestamp, shown beside the name.
 * @param props.isOnline - Toggles the avatar presence dot.
 */
export default function ChatMsgB({
  name,
  image,
  message,
  imageUrl,
  time,
  isOnline,
}: {
  name: string;
  image: string;
  message: string;
  imageUrl?: string | null;
  time: string;
  isOnline?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Avatar
        user={{
          name: name,
          image: image,
          isOnline: isOnline,
        }}
        classname="size-8 shrink-0 [&>img]:rounded-[10px]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold text-(--violet)">
            {name}
          </span>
          <span className="text-[11px] text-(--text-dim)">{time}</span>
        </div>
        {imageUrl && <ChatImage url={imageUrl} />}
        {(message || !imageUrl) && (
          <div data-testid="chat-msg-text" className="whitespace-pre-wrap wrap-break-word text-sm leading-normal text-(--text-strong)">
            <HighlightMentions text={message} />
          </div>
        )}
      </div>
    </div>
  );
}
