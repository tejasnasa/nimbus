/**
 * @module ui/components/ChatMsgA
 * @description Chat row for other users' (and Nimbus's) messages: a rounded
 * square avatar beside a coloured name, the time, and the text underneath.
 * Pair with `ChatMsgB` for the current user's messages, which share the layout.
 */
import { BOT_MENTION } from "@nimbus/types";
import type { ReactNode } from "react";
import Avatar from "./Avatar";
import ChatImage from "./ChatImage";

const MENTION = new RegExp(`(${BOT_MENTION.source})`, "gi");

/** Name colours handed out to people; Nimbus always gets the lime. */
const NAME_COLORS = [
  "text-(--pink)",
  "text-(--sky)",
  "text-(--amber)",
  "text-(--lilac)",
];

/**
 * Picks a stable name colour for a sender so a person keeps one colour.
 *
 * @param name - Sender display name.
 */
function nameColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return NAME_COLORS[hash % NAME_COLORS.length]!;
}

/** Message text with every `@nimbus` mention picked out in violet. */
function MentionedText({ text }: { text: string }) {
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
 * Incoming chat message.
 *
 * @param props.name - Sender display name (lime when `isBot`).
 * @param props.image - Sender avatar URL.
 * @param props.message - Plain-text content (whitespace preserved). The text
 *                       is omitted when it is empty and an image is set.
 * @param props.content - Rich replacement for `message` (for example text with
 *                       links); `message` is then only used to decide whether
 *                       the text shows.
 * @param props.imageUrl - Attached image, shown as a thumbnail above the text.
 * @param props.time - Pre-formatted timestamp, shown beside the name.
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
          <span
            data-testid="chat-msg-name"
            className={`truncate text-[13px] font-semibold ${isBot ? "text-(--lime)" : nameColor(name)}`}
          >
            {name}
          </span>
          <span className="text-[11px] text-(--text-dim)">{time}</span>
        </div>
        {imageUrl && <ChatImage url={imageUrl} />}
        {(message || !imageUrl) && (
          <div data-testid="chat-msg-text" className="whitespace-pre-wrap wrap-break-word text-sm leading-normal text-(--text-strong)">
            {content ?? <MentionedText text={message} />}
          </div>
        )}
      </div>
    </div>
  );
}
