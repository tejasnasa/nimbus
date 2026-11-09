/**
 * @module api/lib/livekit/agentRoom
 * @description Room-level operations the assistant's lifecycle needs from the
 * media server: counting the people in a call, removing the agent from it, and
 * finding out which rooms still exist.
 *
 * @important A room that does not exist reads as empty, not as an error. The
 *            media server creates a room on first join and closes it when the
 *            last participant leaves, so "no such room" is the normal state of a
 *            workspace nobody is calling in. Anything else the server answers
 *            (it is down, the credentials are wrong) is thrown, because callers
 *            must not mistake an outage for an empty room.
 */
import { getRoomServiceClient } from "./client";
import { isAgentParticipant } from "./rooms";

/** Whether the media server answered "no such room". */
function isNotFound(error: unknown): boolean {
  const e = error as { status?: number; code?: string } | null;
  return e?.status === 404 || e?.code === "not_found";
}

/**
 * Lists a room's participants, treating a missing room as empty.
 *
 * @param roomName - The media room.
 */
async function participantsOf(roomName: string) {
  try {
    return await getRoomServiceClient().listParticipants(roomName);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

/**
 * Counts the humans in a room (agents excluded).
 *
 * @param roomName - The media room.
 * @returns The number of non-agent participants.
 * @throws When the media server cannot be reached.
 */
export async function countHumans(roomName: string): Promise<number> {
  const participants = await participantsOf(roomName);
  return participants.filter((p) => !isAgentParticipant(p)).length;
}

/**
 * Removes every agent participant from a room. Best effort: a failure is
 * logged by name only and swallowed, because the caller is ending a meeting and
 * the agent also leaves by itself once told to stop.
 *
 * @param roomName - The media room.
 */
export async function removeAgents(roomName: string): Promise<void> {
  try {
    const client = getRoomServiceClient();
    const agents = (await participantsOf(roomName)).filter(isAgentParticipant);
    await Promise.all(
      agents.map((agent) => client.removeParticipant(roomName, agent.identity)),
    );
  } catch (error) {
    if (isNotFound(error)) return;
    console.error(
      `[meeting] could not remove the agent from ${roomName}:`,
      error instanceof Error ? error.name : "unknown error",
    );
  }
}

/**
 * Names of the rooms the media server currently holds.
 *
 * @returns The set of room names.
 * @throws When the media server cannot be reached.
 */
export async function liveRoomNames(): Promise<Set<string>> {
  const rooms = await getRoomServiceClient().listRooms();
  return new Set(rooms.map((room) => room.name));
}
