/**
 * @module validations/message
 * @description Zod schemas for chat: the `message:send` socket payload and the
 * chat-image signature query.
 *
 * @important These check shape only. Whether an `imageUrl` actually belongs to
 *            the workspace needs the deployment's Cloudinary cloud name, which
 *            only the API has, so the API's `isOwnedChatImageUrl` runs on top of
 *            this schema everywhere an image URL is accepted.
 */
import { z } from "zod";

/** Longest chat message body, in characters. */
export const MESSAGE_MAX_LENGTH = 4000;

/** Longest accepted image URL, in characters. */
export const IMAGE_URL_MAX_LENGTH = 1000;

/**
 * Payload of the `message:send` socket event. `content` may be empty only when
 * an image is attached.
 */
export const messageSendSchema = z
  .object({
    workspaceId: z.string().min(1).max(64),
    content: z.string().max(MESSAGE_MAX_LENGTH),
    imageUrl: z.string().url().max(IMAGE_URL_MAX_LENGTH).optional(),
  })
  .refine((m) => m.content.trim().length > 0 || m.imageUrl !== undefined, {
    message: "A message needs text or an image",
    path: ["content"],
  });

/** Query of `GET /api/upload/chat-image-signature`. */
export const chatImageSignatureQuerySchema = z.object({
  workspaceId: z.string().min(1).max(64),
});
