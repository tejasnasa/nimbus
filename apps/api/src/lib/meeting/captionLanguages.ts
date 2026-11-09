/**
 * @module api/lib/meeting/captionLanguages
 * @description Which caption languages the people watching a meeting have
 * chosen, kept in a Redis hash so every API replica agrees on it.
 *
 * @important The hash `meeting:<id>:langs` maps a socket id to its language. A
 *            socket's field is removed when it changes its mind or disconnects,
 *            so the set of active languages is exactly what connected viewers
 *            want right now. Translation is requested only for those, which is
 *            what keeps the model cost proportional to what is being read.
 *
 * @important The hash carries a TTL as a backstop for a replica that dies
 *            without running its disconnect handlers; `endMeeting` deletes it.
 */
import { pubClient } from "../redis";

/** How long the hash outlives its last write. */
export const CAPTION_LANGUAGE_TTL_SECONDS = 24 * 60 * 60;

/** Redis key of a meeting's socket-to-language hash. */
export const captionLanguagesKey = (meetingId: string) =>
  `meeting:${meetingId}:langs`;

/**
 * Records the language a socket wants captions in.
 *
 * @param meetingId - The meeting.
 * @param socketId - The viewer's socket.
 * @param language - A supported language code.
 */
export async function setCaptionLanguage(
  meetingId: string,
  socketId: string,
  language: string,
): Promise<void> {
  const key = captionLanguagesKey(meetingId);
  await pubClient
    .multi()
    .hset(key, socketId, language)
    .expire(key, CAPTION_LANGUAGE_TTL_SECONDS)
    .exec();
}

/**
 * Forgets a socket's choice.
 *
 * @param meetingId - The meeting.
 * @param socketId - The viewer's socket.
 */
export async function clearCaptionLanguage(
  meetingId: string,
  socketId: string,
): Promise<void> {
  await pubClient.hdel(captionLanguagesKey(meetingId), socketId);
}

/**
 * The distinct languages connected viewers want, sorted.
 *
 * @param meetingId - The meeting.
 */
export async function activeCaptionLanguages(
  meetingId: string,
): Promise<string[]> {
  const values = await pubClient.hvals(captionLanguagesKey(meetingId));
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}
