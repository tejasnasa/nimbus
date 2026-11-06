/**
 * @module api/lib/cloudinary
 * @description Cloudinary SDK surface: the avatar pipeline
 * (`utils.api_sign_request` for `/api/upload/avatar-signature`,
 * `uploader.destroy` for post-deletion cleanup) and the chat-image pipeline
 * (a per-workspace signed upload, the ownership check every image URL passes
 * through, and a best-effort prefix delete when a workspace is removed).
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
import cuid from "cuid";
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
 * Reads the running process's Cloudinary credentials.
 *
 * The one place the three variables are read, at call time and never at module
 * load (where they would be frozen), so every signature and URL check sees the
 * same values the SDK was configured with.
 */
const readEnv = () => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.CLOUDINARY_API_KEY,
  apiSecret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Configures the SDK with the running process's Cloudinary credentials.
 *
 * Idempotent — safe to call from the controller on every request, and
 * deliberately *not* called at module load (where it would freeze
 * `process.env` into the SDK). Tests override the credentials through
 * `vi.mock("cloudinary")`, so this function runs only in production code.
 *
 * @returns The credentials it configured the SDK with.
 */
const configure = () => {
  const env = readEnv();
  cloudinary.config({
    cloud_name: env.cloudName,
    api_key: env.apiKey,
    api_secret: env.apiSecret,
    secure: true,
  });
  return env;
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
  const env = configure();

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
    env.apiSecret!,
  );

  return {
    cloudName: env.cloudName!,
    apiKey: env.apiKey!,
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

/** Cloudinary folder prefix every chat image is stored under. */
export const CHAT_IMAGE_FOLDER = "nimbus/chat";

/** Formats a chat image upload may be, enforced by Cloudinary at upload time. */
export const CHAT_IMAGE_ALLOWED_FORMATS = "jpg,png,webp,heic";

/**
 * Incoming transformation applied by Cloudinary before the original is stored:
 * scales the long edge down to 2048 px and never enlarges.
 */
export const CHAT_IMAGE_TRANSFORMATION = "c_limit,w_2048,h_2048";

/** Folder one workspace's chat images live in. */
export const chatImageFolder = (workspaceId: string): string =>
  `${CHAT_IMAGE_FOLDER}/${workspaceId}`;

/**
 * Signs a chat-image upload into the workspace's own folder.
 *
 * The `public_id` is a fresh cuid, so every upload is a distinct asset and
 * nothing is ever overwritten. Every signed field is returned and must be sent
 * back verbatim: Cloudinary rejects an upload whose signed set differs.
 *
 * @param workspaceId - Workspace the image belongs to (membership is checked by
 *                      the caller, not here).
 * @param userId - Uploader; recorded on the asset as context for audits.
 * @returns The parameters and signature the browser posts to Cloudinary.
 */
export const getChatImageSignature = (workspaceId: string, userId: string) => {
  const env = configure();

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = chatImageFolder(workspaceId);
  const publicId = cuid();
  const context = `uploader=${userId}`;
  const paramsToSign = {
    allowed_formats: CHAT_IMAGE_ALLOWED_FORMATS,
    context,
    folder,
    public_id: publicId,
    timestamp,
    transformation: CHAT_IMAGE_TRANSFORMATION,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    env.apiSecret!,
  );

  return {
    cloudName: env.cloudName!,
    apiKey: env.apiKey!,
    timestamp,
    folder,
    publicId,
    allowedFormats: CHAT_IMAGE_ALLOWED_FORMATS,
    transformation: CHAT_IMAGE_TRANSFORMATION,
    context,
    signature,
  };
};

const PATH_SEGMENT = /^[A-Za-z0-9_,.:-]+$/;
const FILE_SEGMENT = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/;
const ID_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * Whether `url` is an image this deployment's Cloudinary account holds in the
 * given workspace's chat folder.
 *
 * Accepts only
 * `https://res.cloudinary.com/<cloud>/image/upload/[...]/nimbus/chat/<workspaceId>/<file>`.
 *
 * @important Every server path that accepts an image URL must call this. It is
 *            what stops a model being pointed at an arbitrary host and stops
 *            one workspace's image being used from another. It is strict on
 *            purpose: any userinfo, port, backslash, encoded separator or
 *            dot-segment is rejected rather than normalised, because a URL that
 *            two parsers read differently is how a prefix check is bypassed.
 *
 * @param url - Candidate URL from a client.
 * @param workspaceId - The workspace the image must belong to.
 */
export const isOwnedChatImageUrl = (
  url: unknown,
  workspaceId: string,
): boolean => {
  const { cloudName } = readEnv();
  if (typeof url !== "string" || !cloudName || !ID_SEGMENT.test(workspaceId)) {
    return false;
  }
  if (/%(2f|5c|2e|00)|[\\]|\/\.\.?(\/|$|[?#])/i.test(url)) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "res.cloudinary.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return false;
  }

  const segments = parsed.pathname.split("/").slice(1);
  if (segments.length < 7) return false;
  if (
    segments[0] !== cloudName ||
    segments[1] !== "image" ||
    segments[2] !== "upload"
  ) {
    return false;
  }

  const file = segments[segments.length - 1]!;
  const owner = segments.slice(-4, -1);
  if (
    owner[0] !== "nimbus" ||
    owner[1] !== "chat" ||
    owner[2] !== workspaceId ||
    !FILE_SEGMENT.test(file)
  ) {
    return false;
  }

  return segments
    .slice(3, -4)
    .every((s) => s !== "." && s !== ".." && PATH_SEGMENT.test(s));
};

/**
 * Deletes every chat image a workspace uploaded. Best-effort: a failure is
 * logged and swallowed, because it runs while the workspace is being deleted
 * and a leftover asset is the worst outcome.
 *
 * @param workspaceId - The workspace being deleted.
 */
export const destroyChatImages = async (workspaceId: string): Promise<void> => {
  const prefix = `${chatImageFolder(workspaceId)}/`;
  try {
    configure();
    await cloudinary.api.delete_resources_by_prefix(prefix, {
      invalidate: true,
    });
  } catch (error) {
    console.error(
      `[cloudinary] failed to remove chat images under ${prefix}. ` +
        "The workspace has already been deleted; the assets are orphaned.",
      error,
    );
  }
};
