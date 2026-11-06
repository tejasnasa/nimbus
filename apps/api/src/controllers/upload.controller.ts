/**
 * @module api/controllers/upload
 * @description Avatar and chat-image upload signing. The browser needs a Cloudinary
 * signature to upload with `overwrite: true` and `invalidate: true`
 * (unsigned uploads cannot set those parameters), but the API secret
 * must never leave the server, so the browser fetches one signed
 * payload per upload and posts it directly to Cloudinary.
 *
 * The response is `Cache-Control: no-store` because the payload carries
 * a temporary signature (Cloudinary expires signatures after an hour).
 */
import { ServerResponse } from "@nimbus/types";
import { getChatImageSignature, signAvatarUpload } from "../lib/cloudinary";
import { requireWorkspaceRole } from "../lib/workspaceAccess";

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

/**
 * Signs a chat-image upload into a workspace's own folder.
 *
 * @param userId - The authenticated user's id.
 * @param workspaceId - Workspace the image will be posted in.
 * @returns ServerResponse with the signed upload parameters; 404 when the
 *          caller is not a member (the workspace does not exist to them).
 */
export const getChatImageUploadSignature = async (
  userId: string,
  workspaceId: string,
) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId);
    if (!access.ok) return access.response;

    return ServerResponse.ok(getChatImageSignature(workspaceId, userId));
  } catch (error) {
    console.error("[upload] chat image signature failed:", error);
    return ServerResponse.internalError(error);
  }
};
