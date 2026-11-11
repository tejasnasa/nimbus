/**
 * @module web/hooks/useBotTyping
 * @description Whether NimbusBot is currently working on a reply in a
 * workspace, from the server's `bot:typing` signal. The indicator ends when the
 * server says so, when a message from the bot arrives, or after a safety
 * timeout, so a lost `typing: false` can never leave it on for good.
 *
 * @important The server counts overlapping mentions and signals only the first
 *            start and the last end, so a bot message arriving while another
 *            mention is still pending clears the indicator a little early. That
 *            is the intended trade: a stale "typing" is worse than a brief gap.
 */
import { useEffect, useState } from "react";
import { socket } from "../lib/socket";

/** How long the indicator may stay on without a signal that ends it. */
export const BOT_TYPING_SAFETY_MS = 65_000;

/**
 * @param workspaceId - The workspace whose signal to follow; others are ignored.
 * @returns True while the bot is typing.
 */
export function useBotTyping(workspaceId: string): boolean {
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      setTyping(false);
    };

    const onTyping = (data: { workspaceId: string; typing: boolean }) => {
      if (data.workspaceId !== workspaceId) return;
      if (!data.typing) return clear();
      setTyping(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(clear, BOT_TYPING_SAFETY_MS);
    };
    const onMessage = (message: { userId: string; workspaceId?: string }) => {
      if (message.userId === process.env.NEXT_PUBLIC_BOT_USERID) clear();
    };

    socket.on("bot:typing", onTyping);
    socket.on("message:new", onMessage);
    return () => {
      socket.off("bot:typing", onTyping);
      socket.off("message:new", onMessage);
      if (timer) clearTimeout(timer);
    };
  }, [workspaceId]);

  return typing;
}
