/**
 * @module validations/message
 * @description Zod schemas for chat: the `message:send` socket payload and the
 * chat-image signature query.
 *
 * The payload also carries the sender's timezone (so the bot can resolve "on
 * Tuesday" the way the sender means it) and an optional clock override used
 * only to test date handling. Both are advisory input: an unknown timezone
 * falls back to UTC rather than rejecting the message, and the override is
 * ignored by the API in production.
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

/** Longest timezone name or clock override accepted. */
const TIME_FIELD_MAX_LENGTH = 64;

/**
 * Returns the name when it is an IANA timezone this runtime knows, else "UTC".
 *
 * @param value - A timezone name from the client, or nothing.
 * @returns A valid IANA zone name; "UTC" for absent, malformed or unknown ones.
 */
export function normalizeTimeZone(value: string | undefined | null): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

/**
 * Payload of the `message:send` socket event. `content` may be empty only when
 * an image is attached.
 */
export const messageSendSchema = z
  .object({
    workspaceId: z.string().min(1).max(64),
    content: z.string().max(MESSAGE_MAX_LENGTH),
    imageUrl: z.string().url().max(IMAGE_URL_MAX_LENGTH).optional(),
    /** The sender's IANA timezone; an invalid one becomes "UTC". */
    timeZone: z
      .string()
      .max(TIME_FIELD_MAX_LENGTH)
      .optional()
      .transform((value) => normalizeTimeZone(value)),
    /** Test-only "now" (ISO date or timestamp); ignored in production. */
    clockOverride: z.string().max(TIME_FIELD_MAX_LENGTH).optional(),
  })
  .refine((m) => m.content.trim().length > 0 || m.imageUrl !== undefined, {
    message: "A message needs text or an image",
    path: ["content"],
  });

/** Query of `GET /api/upload/chat-image-signature`. */
export const chatImageSignatureQuerySchema = z.object({
  workspaceId: z.string().min(1).max(64),
});
