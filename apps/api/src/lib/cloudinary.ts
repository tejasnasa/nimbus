/**
 * @module api/lib/cloudinary
 * @description Cloudinary SDK surface used by the avatar pipeline:
 * `utils.api_sign_request` for `/api/upload/avatar-signature`, and
 * `uploader.destroy` for post-deletion cleanup.
 *
 * @important The single point where `public_id` is constructed. Cloudinary
 *            matches `overwrite` on `public_id` AND `format`, so the format
 *            must be the same on every replace. Both
 *            sites — signature and destroy — reconstruct the same string,
 *            which is what makes the "one asset per user" premise hold.
 *
 * @important Cloudinary warns that delivery URLs without a version number
 *            are not invalidated by default, and this `public_id` has
 *            slashes. The scheme survives only because the upload
 *            response's `secure_url` carries `/v<version>/`. `User.image`
 *            must therefore *only* ever be that `secure_url`, never a
 *            hand-built URL.
 */
import { v2 as cloudinary } from "cloudinary";

/** Cloudinary "folder" we store every avatar under. */
export const AVATAR_FOLDER = "nimbus/avatars";

/**
 * The exact parameter set the browser signs and sends.
 * Every field except `file`, `api_key`, `cloud_name`, `resource_type` must
 * be covered by the signature; including extra unsigned ones makes
 * Cloudinary reject the upload.
 */
export const AVATAR_SIGNED_PARAMS = [
  "public_id",
  "timestamp",
  "overwrite",
  "invalidate",
  "format",
] as const;

/** The fixed delivery format every avatar is stored as. */
export const AVATAR_FORMAT = "jpg";

/**
 * Configures the SDK with the running process's Cloudinary credentials.
 *
 * Idempotent — safe to call from the controller on every request, and
 * deliberately *not* called at module load (where it would freeze
 * `process.env` into the SDK). Tests override the credentials through
 * `vi.mock("cloudinary")`, so this function runs only in production code.
 */
const configure = () => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
};

/**
 * Builds the deterministic `public_id` for a user's avatar asset.
 *
 * `public_id = nimbus/avatars/<userId>`. With `overwrite: true, invalidate: true`
 * at upload, this is what guarantees exactly one stored asset per user.
 *
 * @param userId - The owning user's id (cuid).
 * @returns The `public_id` Cloudinary stores the asset under.
 */
export const avatarPublicId = (userId: string): string =>
  `${AVATAR_FOLDER}/${userId}`;

/**
 * Signs an avatar upload for the calling user.
 *
 * Returns the parameters the browser sends verbatim plus the signature,
 * which it appends as `signature` before posting. `format` is pinned to
 * `jpg` so `overwrite` matches on `public_id` alone.
 *
 * @param userId - The authenticated user — used as the `public_id`.
 * @returns `cloudName`, `apiKey`, `timestamp`, the parameter set the
 *          browser sends, and the signature Cloudinary will verify.
 */
export const signAvatarUpload = (userId: string) => {
  configure();

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = {
    public_id: avatarPublicId(userId),
    timestamp,
    overwrite: true,
    invalidate: true,
    format: AVATAR_FORMAT,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET!,
  );

  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
    apiKey: process.env.CLOUDINARY_API_KEY!,
    timestamp,
    publicId: paramsToSign.public_id,
    format: AVATAR_FORMAT,
    signature,
  };
};

/**
 * Deletes a user's avatar from Cloudinary.
 *
 * Failure is deliberately non-fatal: the user is already gone by the
 * time this runs (it's wired into `afterDelete`), so a leftover asset
 * is the worst case and logging is louder than throwing.
 *
 * @param userId - The user whose avatar should be removed.
 */
export const destroyAvatar = async (userId: string): Promise<void> => {
  configure();

  try {
    await cloudinary.uploader.destroy(avatarPublicId(userId), {
      invalidate: true,
    });
  } catch (error) {
    console.error(
      `[cloudinary] failed to remove avatar asset for user ${userId}. ` +
      "The user has already been deleted; the asset is orphaned.",
      error,
    );
  }
};
