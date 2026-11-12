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
  /**
   * The speaker was talking to the assistant: by wake phrase, inside the window
   * a bare wake word opens, or while holding the Ask button.
   */
  addressed?: boolean;
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
  feature: "transcription" | "speech";
  model: string;
  /** Seconds of audio transcribed; transcription only. */
  audioSeconds?: number;
  /** Characters synthesized; speech only. */
  characters?: number;
  latencyMs: number;
  status: "OK" | "ERROR";
  /** Curated reason for a failed request. */
  errorReason?: "invalid-key" | "provider-error" | "timeout";
};

/** `POST /internal/agent/usage` request. */
export type UsageRequest = { entries: UsageIn[] };

/**
 * `POST /internal/agent/answer` request: answer an addressed utterance.
 *
 * The reply is stored under `replySeq`, a sequence number the agent reserved
 * from its own counter, so it can never collide with a caption the agent posts
 * later.
 */
export type AnswerRequest = {
  /** The addressed segment's sequence number. */
  seq: number;
  /** Where the spoken reply is stored in the transcript. */
  replySeq: number;
  /** Whether the agent will speak the reply; false sends it to chat instead. */
  speak: boolean;
};

/** Why an answer could not be given. Curated; never provider text. */
export type AnswerErrorReason =
  | "refused"
  | "not-found"
  | "stopped"
  | "timeout"
  | "failed";

/**
 * One line of the `application/x-ndjson` answer stream: text deltas, then
 * exactly one `done` or `error`.
 */
export type AnswerLine =
  | { type: "delta"; text: string }
  | {
      type: "done";
      /** The stored reply's sequence number, or null when nothing was stored. */
      segmentSeq: number | null;
      /** Where the reply went: spoken in the call, or posted to chat. */
      channel: "voice" | "chat";
    }
  | { type: "error"; reason: AnswerErrorReason };

/** Things the agent may ask the API to tell the workspace in chat. */
export type AgentNoticeKind = "budget-warning" | "budget-ended";

/** `POST /internal/agent/notice` request. */
export type NoticeRequest = { kind: AgentNoticeKind };

/** `POST /internal/agent/ended` request. */
export type EndedRequest = {
  reason: "stopped" | "budget" | "agent-ended" | "invalid-key" | "shutdown";
};

/** Names that address the assistant in speech. */
export const AGENT_WAKE_NAMES = ["nimbus", "nimbus bot", "nimbusbot"] as const;

/** RPC a browser calls on the agent while the Ask button is held or released. */
export const AGENT_RPC_ASK = "nimbus.ask";

/** RPC a browser calls on the agent to stop it speaking. */
export const AGENT_RPC_STOP = "nimbus.stop";

/** Payload of {@link AGENT_RPC_ASK}. */
export type AskRpcPayload = { pressed: boolean };

/** Name of the audio track the agent speaks on. */
export const AGENT_VOICE_TRACK = "nimbus-voice";

/** What the assistant says, or posts, when free time is running out or gone. */
export const AGENT_NOTICE_TEXT: Record<AgentNoticeKind, string> = {
  "budget-warning": "About thirty seconds of free assistant time left.",
  "budget-ended":
    "That was the free assistant time. A workspace admin can add a key in settings.",
};
