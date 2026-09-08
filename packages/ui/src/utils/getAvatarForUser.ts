/**
 * @module ui/utils/getAvatarForUser
 * @description Deterministic fallback avatar picker for users without a custom image.
 *
 * Hashes the user ID to one of five bundled pictures so the same user always
 * gets the same avatar across sessions and devices without any storage.
 */

/** Pool of bundled fallback avatar images. */
import pic1 from "../assets/avatars/picture1.jpg";
import pic2 from "../assets/avatars/picture2.jpg";
import pic3 from "../assets/avatars/picture3.jpg";
import pic4 from "../assets/avatars/picture4.jpg";
import pic5 from "../assets/avatars/picture5.jpg";

const avatars = [pic1, pic2, pic3, pic4, pic5];

/**
 * Hashes a user ID to a stable array index using a 31-multiplier string hash.
 *
 * @param userId - User ID (cuid string or numeric ID) to hash.
 * @returns Unsigned 32-bit hash value.
 */
function hashUserId(userId: string | number): number {
  const str = String(userId);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Returns a deterministic fallback avatar URL for the given user.
 *
 * @param userId - User ID to map to an avatar; falsy values fall back to the first picture.
 * @returns Resolved image `src` URL.
 */
export function getAvatarForUser(userId: string | number | undefined): string {
  if (!userId) return avatars[0]!.src;
  return avatars[hashUserId(userId) % avatars.length]!.src ?? avatars[0]!.src;
}
