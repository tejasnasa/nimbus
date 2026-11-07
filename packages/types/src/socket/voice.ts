/**
 * @module socket/voice
 * @description Shape of a single voice channel participant.
 *
 * Serialized as JSON into the Redis Hash `voice_presence:{workspaceId}`
 * (`userId → VoiceUser`) with a 24h TTL, and broadcast to clients as the call
 * roster. Mute state is not part of it: it lives on the participant's published
 * microphone track in the media room, which is where a client reads it from.
 */

/** A user currently present in a workspace's voice channel. */
export type VoiceUser = {
  userId: string;
  name: string;
  image: string | null;
};
