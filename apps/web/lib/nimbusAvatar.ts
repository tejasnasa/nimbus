/**
 * @module web/lib/nimbusAvatar
 * @description The picture used wherever Nimbus itself appears as a person:
 * NimbusBot's chat messages and member row, and the voice assistant in the
 * call. It is the Nimbus mark on a dark square, served from `public/`.
 * @important The file hardcodes the `--violet`, `--lime` and `--surface-3`
 *            colours, because CSS variables do not reach an image; change it
 *            with the tokens.
 */
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";

/** Public path of the Nimbus avatar image. */
export const NIMBUS_AVATAR = "/nimbus-avatar.svg";

/**
 * Picks the avatar for a person, using the Nimbus mark for the bot and the
 * voice agent.
 *
 * @param userId - The person's id (a user id, or a call participant identity).
 * @param image - Their uploaded picture, if any.
 * @param isAgent - Whether this is the voice agent in a call.
 * @returns The image URL to show.
 */
export function avatarFor(
  userId: string,
  image: string | null | undefined,
  isAgent = false,
): string {
  if (isAgent || userId === process.env.NEXT_PUBLIC_BOT_USERID) {
    return NIMBUS_AVATAR;
  }
  return image || getAvatarForUser(userId);
}
