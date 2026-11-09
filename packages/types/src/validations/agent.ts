/**
 * @module validations/agent
 * @description Zod schemas for the bodies the voice agent posts to the API's
 * internal routes. The matching TypeScript types are in `api/agent`.
 *
 * @important Limits are generous enough for a batch of utterances but small
 *            enough that a compromised agent cannot post an unbounded body.
 */
import { z } from "zod";

/** Body of `POST /internal/agent/redeem`. */
export const redeemSchema = z.object({
  ticket: z.string().min(16).max(128),
});

const segmentInSchema = z.object({
  seq: z.number().int().min(1).max(1_000_000),
  speakerUserId: z.string().min(1).max(64).nullable(),
  speakerName: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(4000),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  language: z.string().min(2).max(16).optional(),
});

/** Body of `POST /internal/agent/segments`. */
export const segmentsInSchema = z.object({
  segments: z.array(segmentInSchema).min(1).max(50),
});

/** Body of `POST /internal/agent/state`. */
export const agentStateSchema = z.object({
  state: z.enum(["listening", "thinking", "speaking"]),
  speakingUserIds: z.array(z.string().min(1).max(64)).max(50).optional(),
});

const usageInSchema = z.object({
  feature: z.literal("transcription"),
  model: z.string().min(1).max(200),
  audioSeconds: z.number().min(0).max(3600),
  latencyMs: z.number().min(0).max(600_000),
  status: z.enum(["OK", "ERROR"]),
  errorReason: z.enum(["invalid-key", "provider-error", "timeout"]).optional(),
});

/** Body of `POST /internal/agent/usage`. */
export const usageInBodySchema = z.object({
  entries: z.array(usageInSchema).min(1).max(100),
});

/** Body of `POST /internal/agent/ended`. */
export const endedSchema = z.object({
  reason: z.enum(["stopped", "budget", "agent-ended", "invalid-key", "shutdown"]),
});
