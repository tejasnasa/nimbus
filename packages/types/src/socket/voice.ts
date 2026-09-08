/**
 * @module socket/voice
 * @description Shape of a single voice channel participant.
 *
 * Serialized as JSON into the Redis Hash `voice_presence:{workspaceId}`
 * (`userId → VoiceUser`) with a 24h TTL, and broadcast to clients so they
 * can render the voice channel roster and mute indicators.
 */

/** A user currently present in a workspace's voice channel. */
export type VoiceUser = {
  userId: string;
  name: string;
  image: string | null;
  /** True when the user's microphone is muted. */
  isMuted: boolean;
};
