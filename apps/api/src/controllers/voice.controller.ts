/**
 * @module api/controllers/voice
 * @description The REST surface of voice: minting a call token and reading the
 * current roster. Both are workspace-scoped and answer a non-member with the
 * same 404 as any other workspace read, so neither confirms that a workspace
 * exists.
 *
 * @important The token is the only credential the media server accepts, and it
 *            is minted here after a membership check. The check is repeated on
 *            every request; a removed member can no longer obtain a token, and
 *            is disconnected from any call they are already in by
 *            `lib/livekit/revocation`.
 */
import { ServerResponse, type VoiceUser } from "@nimbus/types";
import { livekitUrl } from "../lib/livekit/client";
import { roomNameFor } from "../lib/livekit/rooms";
import { createParticipantToken } from "../lib/livekit/tokens";
import { requireWorkspaceRole } from "../lib/workspaceAccess";
import { voicePresenceService } from "../lib/voicePresence";

/** What the browser needs to connect to a workspace's call. */
export type VoiceTokenResponse = {
  token: string;
  url: string;
  roomName: string;
};

/**
 * Issues a call token to a member.
 *
 * @param user - The authenticated user.
 * @param workspaceId - The workspace whose call to join.
 * @returns The token, the media server URL and the room name; 404 for a
 *          non-member; a curated 500 when voice is misconfigured.
 */
export const createVoiceToken = async (
  user: { id: string; name: string; image?: string | null },
  workspaceId: string,
) => {
  try {
    const access = await requireWorkspaceRole(user.id, workspaceId);
    if (!access.ok) return access.response;

    const token = await createParticipantToken({ user, workspaceId });
    const body: VoiceTokenResponse = {
      token,
      url: livekitUrl(),
      roomName: roomNameFor(workspaceId),
    };

    return ServerResponse.ok(body, "Voice token issued");
  } catch (error) {
    console.error("[voice] could not mint a token:", error);
    return ServerResponse.internalError(null, "Voice is unavailable right now");
  }
};

/**
 * Reads who is on a workspace's call, for server rendering and initial paint.
 *
 * @param userId - The authenticated user.
 * @param workspaceId - The workspace to read.
 * @returns `{ users }`, or 404 for a non-member.
 */
export const getVoiceRoster = async (userId: string, workspaceId: string) => {
  try {
    const access = await requireWorkspaceRole(userId, workspaceId);
    if (!access.ok) return access.response;

    const users: VoiceUser[] = await voicePresenceService.getUsers(workspaceId);
    return ServerResponse.ok({ users });
  } catch (error) {
    return ServerResponse.internalError(error);
  }
};
