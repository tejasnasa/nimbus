/**
 * @module api/lib/livekit/rooms
 * @description The naming contract between a workspace and its media room, and
 * the test for "is this participant a human".
 *
 * @important One room per workspace, named `nimbus-ws-<workspaceId>`. Every
 *            webhook event is mapped back to a workspace through
 *            {@link workspaceIdFromRoom}, and a room that does not parse is
 *            ignored: the LiveKit project can carry rooms this app did not
 *            create, and none of them may touch a workspace's roster.
 */

const ROOM_PREFIX = "nimbus-ws-";

/** Name the voice agent registers under; only an explicit dispatch reaches it. */
export const AGENT_NAME = "nimbus";

/** Prefix of the identity LiveKit gives a worker that joins as an agent. */
const AGENT_IDENTITY_PREFIX = "agent-";

/** `ParticipantInfo.Kind.AGENT` in the media server's protocol. */
const PARTICIPANT_KIND_AGENT = 4;

/**
 * The media room that carries a workspace's call.
 *
 * @param workspaceId - The workspace's cuid.
 * @returns The room name.
 */
export function roomNameFor(workspaceId: string): string {
  return `${ROOM_PREFIX}${workspaceId}`;
}

/**
 * Recovers the workspace a room belongs to.
 *
 * @param room - A room name from a webhook or the media server.
 * @returns The workspace id, or `null` for anything that is not exactly a
 *          Nimbus workspace room (a foreign name, an empty id, or stray
 *          characters).
 */
export function workspaceIdFromRoom(
  room: string | undefined | null,
): string | null {
  if (!room || !room.startsWith(ROOM_PREFIX)) return null;
  const workspaceId = room.slice(ROOM_PREFIX.length);
  return /^[A-Za-z0-9_-]+$/.test(workspaceId) ? workspaceId : null;
}

/**
 * Whether an identity belongs to an agent worker rather than a signed-in user.
 * User identities are database ids, which never start with the agent prefix.
 *
 * @param identity - A participant identity.
 */
export function isAgentIdentity(identity: string | undefined | null): boolean {
  return !!identity && identity.startsWith(AGENT_IDENTITY_PREFIX);
}

/**
 * Whether a webhook participant is an agent, by the kind the media server
 * reports or, failing that, by identity.
 *
 * @param participant - The participant block of a webhook event.
 */
export function isAgentParticipant(participant: {
  identity?: string;
  kind?: number;
}): boolean {
  return (
    participant.kind === PARTICIPANT_KIND_AGENT ||
    isAgentIdentity(participant.identity)
  );
}
