/**
 * @module types/api/agent
 * @description The internal contract between the API and the voice agent, so
 * both sides compile against one definition. Bodies are validated on the API
 * with the matching schemas in `validations/agent`.
 *
 * @important The redeem response is the only payload in the system that carries
 *            a plaintext provider key. It travels from the API to the agent
 *            over the authenticated internal route and nowhere else.
 */

/** A member the agent may name as a speaker. */
export type AgentMember = { userId: string; name: string };

/** The voice settings an agent session runs with. */
export type AgentVoiceConfig = {
  /** OpenAI-compatible base URL, with no trailing slash. */
  baseUrl: string;
  /** Plaintext key for this session. Never log it. */
  apiKey: string;
  transcribeModel: string;
  speechModel?: string;
  voice?: string;
  language?: string;
};

/** `POST /internal/agent/redeem` request. */
export type RedeemRequest = { ticket: string };

/** `POST /internal/agent/redeem` response. */
export type RedeemResponse = {
  /** Sent as `X-Meeting-Session` on every later request. */
  sessionToken: string;
  meetingId: string;
  workspaceId: string;
  roomName: string;
  /** ISO time the meeting started; caption times are relative to it. */
  startedAt: string;
  members: AgentMember[];
  voice: AgentVoiceConfig;
  /** Seconds the session may run, or null for no limit. */
  budgetSeconds: number | null;
  assistantSpeaks: boolean;
  /** Lower-case names that address the assistant. */
  wakeNames: string[];
};

/** One transcribed utterance sent to the API. */
export type SegmentIn = {
  /** Monotonic per session, assigned at end of speech. Idempotency key. */
  seq: number;
  speakerUserId: string | null;
  speakerName: string;
  text: string;
  startMs: number;
  endMs: number;
  language?: string;
};

/** `POST /internal/agent/segments` request. */
export type SegmentsRequest = { segments: SegmentIn[] };

/** `POST /internal/agent/segments` response. */
export type SegmentsResponse = {
  /** Sequence numbers the API has stored (including replays). */
  accepted: number[];
  stop: boolean;
};

/** `POST /internal/agent/state` request. */
export type StateRequest = {
  state: "listening" | "thinking" | "speaking";
  speakingUserIds?: string[];
};

/** Response carrying only the stop flag. */
export type StopResponse = { stop: boolean };

/** One provider request the agent made, reported for the call log. */
export type UsageIn = {
  feature: "transcription";
  model: string;
  audioSeconds: number;
  latencyMs: number;
  status: "OK" | "ERROR";
  /** Curated reason for a failed request. */
  errorReason?: "invalid-key" | "provider-error" | "timeout";
};

/** `POST /internal/agent/usage` request. */
export type UsageRequest = { entries: UsageIn[] };

/** `POST /internal/agent/ended` request. */
export type EndedRequest = {
  reason: "stopped" | "budget" | "agent-ended" | "invalid-key" | "shutdown";
};

/** Names that address the assistant in speech. */
export const AGENT_WAKE_NAMES = ["nimbus", "nimbus bot", "nimbusbot"] as const;
