/**
 * @module api/lib/botMessage
 * @description Posting a chat message as NimbusBot: persist it, then broadcast
 * it to the workspace room as `message:new`, the same path a reply to a
 * mention takes.
 *
 * @important The bot's user row (`BOT_USERID`) must exist; the API upserts it at
 *            boot. A message is only broadcast after it is stored, so a client
 *            never shows a message a reload would lose.
 */
import { prisma } from "@nimbus/db";
import type { Server } from "socket.io";
import { env } from "./env";

/** The slice of Socket.IO a bot message is broadcast through. */
export type BotMessageBroadcaster = Pick<Server, "to">;

/**
 * Persists a bot chat message and broadcasts it to the workspace.
 *
 * @param io - Broadcaster for `message:new`.
 * @param workspaceId - The workspace the message belongs to.
 * @param content - The message text.
 */
export async function postBotMessage(
  io: BotMessageBroadcaster,
  workspaceId: string,
  content: string,
): Promise<void> {
  const message = await prisma.message.create({
    data: { content, userId: env.BOT_USERID, workspaceId },
    include: { user: true },
  });
  io.to(workspaceId).emit("message:new", {
    ...message,
    name: message.user.name,
    image: message.user.image,
  });
}
