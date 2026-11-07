/**
 * @module api/lib/livekit/tokens
 * @description Mints the access token a browser presents to the media server.
 *
 * @important The grant is deliberately narrow: one room, microphone as the only
 *            publishable source, so a client cannot publish camera or screen
 *            video even with a hand-built SDK call. The 10 minute lifetime is
 *            the connect window only; a connected participant is kept alive by
 *            the media server and is not dropped when the token expires.
 */
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { livekitCredentials } from "./client";
import { roomNameFor } from "./rooms";

/** How long a token is valid for connecting. */
export const TOKEN_TTL = "10m";

/**
 * Creates a join token for a member of a workspace.
 *
 * @param params.user - The authenticated user; their id becomes the identity.
 * @param params.workspaceId - The workspace whose call the token opens.
 * @returns The signed JWT.
 */
export async function createParticipantToken({
  user,
  workspaceId,
}: {
  user: { id: string; name: string; image?: string | null };
  workspaceId: string;
}): Promise<string> {
  const { apiKey, apiSecret } = livekitCredentials();

  const token = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    name: user.name,
    metadata: JSON.stringify({ image: user.image ?? null }),
    ttl: TOKEN_TTL,
  });

  token.addGrant({
    roomJoin: true,
    room: roomNameFor(workspaceId),
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
    canPublishData: true,
  });

  return token.toJwt();
}
