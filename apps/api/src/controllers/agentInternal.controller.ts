/**
 * @module api/controllers/agentInternal
 * @description The handlers behind `/internal/agent/*`: redeeming a ticket,
 * receiving the transcript, relaying the agent's state, answering an addressed
 * question as a stream, posting the agent's notices to chat, recording its
 * provider usage, and accepting its goodbye.
 *
 * @important `redeem` returns the only plaintext provider key in any HTTP
 *            response in this codebase. Nothing here logs a request or response
 *            body, and the router is excluded from request logging. Do not add
 *            logging of either, and do not copy the voice block of the payload
 *            into an error path.
 *
 * @important Every response after `redeem` carries a `stop` flag. It is true
 *            when the meeting is no longer live, when someone asked to stop it,
 *            or when the workspace's spend cap is reached, and it is how the
 *            agent learns it must leave. Segments are still accepted for a short
 *            grace period after a meeting ends, because the agent flushes what
 *            it has already transcribed on its way out.
 */
import {
  AGENT_NOTICE_TEXT,
  agentStateSchema,
  answerSchema,
  endedSchema,
  noticeSchema,
  redeemSchema,
  segmentsInSchema,
  ServerResponse,
  usageInBodySchema,
  modelById,
  type AiProviderId,
  type AnswerLine,
  type MeetingEndReason,
  type RedeemResponse,
  type SegmentsResponse,
  type StopResponse,
} from "@nimbus/types";
import { recordAiCall } from "../lib/ai/callLog";
import { postBotMessage } from "../lib/botMessage";
import { answer } from "../lib/meeting/assistant";
import { getProvider } from "../lib/ai/providers";
import { isOverCap } from "../lib/ai/spendCap";
import {
  SESSION_TTL_SECONDS,
  type AgentSession,
} from "../lib/meeting/agentSession";
import {
  endMeeting,
  isStopRequested,
  stateKey,
  type MeetingBroadcaster,
  type MeetingRow,
} from "../lib/meeting/lifecycle";
import { ingestSegments } from "../lib/meeting/segments";
import { redeemTicket } from "../lib/meeting/tickets";
import { pubClient } from "../lib/redis";

/** How long after a meeting ends the agent may still post its final segments. */
export const INGEST_GRACE_MS = 120_000;

/** Request context established by the agent session middleware. */
export type AgentContext = { session: AgentSession; meeting: MeetingRow };

/** The same bare answer for every redemption failure. */
const REDEEM_DENIED = () => ServerResponse.unauthorized("Unauthorized");

/** Whether the agent should leave, given the meeting's current state. */
async function shouldStop(meeting: MeetingRow): Promise<boolean> {
  return meeting.status !== "LIVE" || (await isStopRequested(meeting.id));
}

/**
 * Redeems a dispatch ticket for the session's configuration and keys.
 *
 * @param body - The raw request body.
 * @param deps.io - Broadcaster, used when a refused redemption ends the meeting.
 * @returns The payload, or a bare 401 for every kind of failure.
 */
export async function redeem(
  body: unknown,
  deps: { io?: MeetingBroadcaster } = {},
) {
  const parsed = redeemSchema.safeParse(body);
  if (!parsed.success) return REDEEM_DENIED();

  try {
    const result = await redeemTicket(parsed.data.ticket);
    if (!result.ok) {
      if (result.endMeeting) {
        await endMeeting(result.endMeeting.meetingId, result.endMeeting.reason, deps);
      }
      return REDEEM_DENIED();
    }
    return ServerResponse.ok<RedeemResponse>(result.payload, "Redeemed");
  } catch (error) {
    console.error(
      "[agent] redemption failed:",
      error instanceof Error ? error.name : "unknown error",
    );
    return REDEEM_DENIED();
  }
}

/**
 * Stores a batch of transcript segments.
 *
 * @param context - The authenticated session and its meeting.
 * @param body - The raw request body.
 * @param deps.io - Broadcaster for `meeting:segment`.
 */
export async function postSegments(
  context: AgentContext,
  body: unknown,
  deps: { io?: MeetingBroadcaster } = {},
) {
  const parsed = segmentsInSchema.safeParse(body);
  if (!parsed.success) return ServerResponse.badRequest("Invalid segments");

  const { meeting } = context;
  const stop = await shouldStop(meeting);
  const withinGrace =
    meeting.status === "LIVE" ||
    (meeting.endedAt !== null &&
      Date.now() - meeting.endedAt.getTime() <= INGEST_GRACE_MS);
  if (!withinGrace) {
    return ServerResponse.ok<SegmentsResponse>({ accepted: [], stop: true });
  }

  try {
    const { accepted } = await ingestSegments(
      meeting,
      parsed.data.segments,
      deps,
    );
    return ServerResponse.ok<SegmentsResponse>({ accepted, stop });
  } catch (error) {
    console.error(
      `[agent] could not store segments for ${meeting.id}:`,
      error instanceof Error ? error.name : "unknown error",
    );
    return ServerResponse.internalError(null, "Could not store segments");
  }
}

/**
 * Relays the agent's state and who it hears speaking to the workspace.
 *
 * @param context - The authenticated session and its meeting.
 * @param body - The raw request body.
 * @param deps.io - Broadcaster for the two events.
 */
export async function postState(
  context: AgentContext,
  body: unknown,
  deps: { io?: MeetingBroadcaster } = {},
) {
  const parsed = agentStateSchema.safeParse(body);
  if (!parsed.success) return ServerResponse.badRequest("Invalid state");

  const { meeting } = context;
  const stop = await shouldStop(meeting);
  if (meeting.status !== "LIVE") {
    return ServerResponse.ok<StopResponse>({ stop: true });
  }

  const { state, speakingUserIds } = parsed.data;
  const previous = await pubClient.set(
    stateKey(meeting.id),
    state,
    "EX",
    SESSION_TTL_SECONDS,
    "GET",
  );
  if (previous !== state) {
    deps.io
      ?.to(meeting.workspaceId)
      .emit("meeting:assistant-state", { meetingId: meeting.id, state });
  }
  if (speakingUserIds) {
    deps.io
      ?.to(meeting.workspaceId)
      .emit("meeting:speaking", {
        meetingId: meeting.id,
        userIds: speakingUserIds,
      });
  }
  return ServerResponse.ok<StopResponse>({ stop });
}

/**
 * Writes the agent's provider requests to the workspace call log, then checks
 * the spend cap.
 *
 * @param context - The authenticated session and its meeting.
 * @param body - The raw request body.
 * @param deps.io - Broadcaster, used if the cap ends the meeting.
 */
export async function postUsage(
  context: AgentContext,
  body: unknown,
  deps: { io?: MeetingBroadcaster } = {},
) {
  const parsed = usageInBodySchema.safeParse(body);
  if (!parsed.success) return ServerResponse.badRequest("Invalid usage");

  const { meeting, session } = context;
  const provider = getProvider(session.providerId as AiProviderId);
  const source = meeting.source === "FREE" ? "free" : "byok";

  for (const entry of parsed.data.entries) {
    const model = provider ? modelById(provider, entry.model) : undefined;
    await recordAiCall({
      workspaceId: meeting.workspaceId,
      userId: meeting.startedById,
      meetingId: meeting.id,
      feature: entry.feature,
      providerId: session.providerId,
      modelId: entry.model,
      source,
      pricing: model?.pricing,
      credentialId: session.credentialId,
      status: entry.status,
      errorReason: entry.errorReason ?? null,
      usage:
        entry.feature === "speech"
          ? { characters: entry.characters ?? 0 }
          : { audioSeconds: entry.audioSeconds ?? 0 },
      latencyMs: entry.latencyMs,
    });
  }

  let stop = await shouldStop(meeting);
  if (!stop && (await isOverCap(meeting.workspaceId))) {
    await endMeeting(meeting.id, "spend-cap", deps);
    stop = true;
  }
  return ServerResponse.ok<StopResponse>({ stop });
}

/** Where an answer stream is written. */
export type AnswerSink = {
  /** Starts the stream: status 200 and the NDJSON content type. */
  open(): void;
  /** Writes one line. */
  write(line: AnswerLine): void;
  /** Aborted when the agent hangs up. */
  signal: AbortSignal;
};

/**
 * Answers an addressed utterance as an `application/x-ndjson` stream.
 *
 * @param context - The authenticated session and its meeting.
 * @param body - The raw request body.
 * @param sink - Where the lines go.
 * @param deps.io - Broadcaster for the stored reply or the chat message.
 * @returns A response to send instead of a stream when the body is invalid;
 *          null once the stream has been written (the caller ends it).
 */
export async function postAnswer(
  context: AgentContext,
  body: unknown,
  sink: AnswerSink,
  deps: { io?: MeetingBroadcaster } = {},
) {
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return ServerResponse.badRequest("Invalid answer request");

  sink.open();
  const { meeting } = context;
  if (await shouldStop(meeting)) {
    sink.write({ type: "error", reason: "stopped" });
    return null;
  }
  await answer({
    meeting,
    seq: parsed.data.seq,
    replySeq: parsed.data.replySeq,
    speak: parsed.data.speak,
    signal: sink.signal,
    emit: (line) => sink.write(line),
    io: deps.io,
  });
  return null;
}

/**
 * Posts one of the agent's fixed notices (free time running out, or gone) to
 * the workspace chat as NimbusBot. The text is chosen here from the notice
 * kind; the agent never supplies words for chat.
 *
 * @param context - The authenticated session and its meeting.
 * @param body - The raw request body.
 * @param deps.io - Broadcaster for `message:new`.
 */
export async function postNotice(
  context: AgentContext,
  body: unknown,
  deps: { io?: MeetingBroadcaster } = {},
) {
  const parsed = noticeSchema.safeParse(body);
  if (!parsed.success) return ServerResponse.badRequest("Invalid notice");

  const { meeting } = context;
  const stop = await shouldStop(meeting);
  try {
    if (deps.io) {
      await postBotMessage(
        deps.io,
        meeting.workspaceId,
        AGENT_NOTICE_TEXT[parsed.data.kind],
      );
    }
  } catch (error) {
    console.error(
      `[agent] could not post a notice for ${meeting.id}:`,
      error instanceof Error ? error.name : "unknown error",
    );
    return ServerResponse.internalError(null, "Could not post the notice");
  }
  return ServerResponse.ok<StopResponse>({ stop });
}

const AGENT_REASON_TO_END_REASON: Record<
  "stopped" | "budget" | "agent-ended" | "invalid-key" | "shutdown",
  MeetingEndReason
> = {
  stopped: "stopped",
  budget: "budget",
  "agent-ended": "agent-ended",
  "invalid-key": "invalid-key",
  shutdown: "agent-ended",
};

/**
 * Accepts the agent's goodbye and ends the meeting.
 *
 * @param context - The authenticated session and its meeting.
 * @param body - The raw request body.
 * @param deps.io - Broadcaster for `meeting:ended`.
 */
export async function postEnded(
  context: AgentContext,
  body: unknown,
  deps: { io?: MeetingBroadcaster } = {},
) {
  const parsed = endedSchema.safeParse(body);
  if (!parsed.success) return ServerResponse.badRequest("Invalid reason");

  await endMeeting(
    context.meeting.id,
    AGENT_REASON_TO_END_REASON[parsed.data.reason],
    deps,
  );
  return ServerResponse.ok({}, "Goodbye");
}
