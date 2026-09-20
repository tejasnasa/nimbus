/**
 * @module api/controllers/upload
 * @description Avatar upload signing. The browser needs a Cloudinary
 * signature to upload with `overwrite: true` and `invalidate: true`
 * (unsigned uploads cannot set those parameters — plan §2.3), but the
 * API secret must never leave the server, so the browser fetches one
 * signed payload per upload and posts it directly to Cloudinary.
 *
 * The response is `Cache-Control: no-store` because the payload carries
 * a temporary signature (Cloudinary expires signatures after an hour —
 * plan §2.3 rule 4).
 */
import { ServerResponse } from "@nimbus/types";
import { signAvatarUpload } from "../lib/cloudinary";

/**
 * Signs an avatar upload for the calling user.
 *
 * @param userId - The authenticated user's id (used as the
 *                 deterministic `public_id`).
 * @returns ServerResponse carrying the cloud name, API key, timestamp,
 *          `public_id`, fixed format, and the upload signature. The
 *          API secret is never included.
 */
export const getAvatarSignature = async (userId: string) => {
  try {
    const payload = signAvatarUpload(userId);
    return ServerResponse.ok(payload);
  } catch (error) {
    console.error("[upload] avatar signature failed:", error);
    return ServerResponse.internalError(error);
  }
};
