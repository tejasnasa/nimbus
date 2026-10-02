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

/**
 * Resolves an imported image asset to a URL string.
 *
 * The bundlers this package is consumed through disagree on the import shape:
 * Next.js returns `{ src, height, width }` metadata, while Vite (and therefore
 * Vitest) returns the URL string itself. Reading `.src` unconditionally yields
 * `undefined` under the second, so both shapes are handled here.
 *
 * @param asset - Imported asset in either shape.
 * @returns Usable image URL, or `""` when neither shape matches.
 */
export function assetSrc(asset: unknown): string {
  if (typeof asset === "string") return asset;
  if (
    asset &&
    typeof asset === "object" &&
    "src" in asset &&
    typeof (asset as { src: unknown }).src === "string"
  ) {
    return (asset as { src: string }).src;
  }
  return "";
}

/** Resolved URLs, normalised once at module load so lookups stay a plain index. */
const avatars: string[] = [pic1, pic2, pic3, pic4, pic5].map(assetSrc);

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
 * @returns Resolved image URL.
 */
export function getAvatarForUser(userId: string | number | undefined): string {
  // `avatars` is built from a five-element literal, so both lookups are always
  // in range — the assertions are here only to satisfy indexed-access checking.
  if (!userId) return avatars[0]!;
  return avatars[hashUserId(userId) % avatars.length]!;
}
