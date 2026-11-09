/**
 * @module agent/index
 * @description LiveKit worker definition: prewarm, entry and the agent name.
 *
 * Joins a room only when dispatched by name, trades the dispatch ticket for the
 * session's configuration, then listens to every human audio track separately
 * and posts the transcript to the Nimbus API.
 *
 * @important `agentName` switches the worker to explicit dispatch, so it never
 *            joins a room on its own; the API creates the dispatch and carries
 *            a one-time ticket in the dispatch metadata, nothing else. The
 *            ticket is redeemed before the room is joined, so a dispatch with a
 *            bad or reused ticket never reaches a call. The room is joined
 *            audio-only.
 *
 * @important The Silero model is loaded once per process in `prewarm`, because
 *            loading it per job would add its start-up time to every meeting.
 *            Each idle process holds its own copy (about 300 MB), which is why
 *            `numIdleProcesses` is 1 and no custom load threshold is set (the
 *            hosting platform ignores one).
 *
 * @important The voice key from the redeem response lives only in the session's
 *            memory for the length of the meeting. It is never logged.
 */
import {
  AutoSubscribe,
  cli,
  defineAgent,
  log,
  ServerOptions,
  type JobContext,
  type JobProcess,
  type VAD,
} from "@livekit/agents";
import { VAD as SileroVAD } from "@livekit/agents-plugin-silero";
import { fileURLToPath } from "node:url";
import { NimbusClient } from "./api/nimbusClient.js";
import { framesOfTrack } from "./audio/trackFrames.js";
import { isAllowedProviderUrl, loadConfig } from "./config.js";
import { createMeetingClock } from "./session/clock.js";
import { VAD_OPTIONS } from "./vadOptions.js";
import { MeetingSession, type RoomLike } from "./session/meetingSession.js";

/** Name the API passes when it dispatches the agent to a room. */
export const AGENT_NAME = "nimbus";

interface WorkerUserData extends Record<string, unknown> {
  vad?: VAD;
}

/**
 * Reads the ticket from the dispatch metadata.
 *
 * @param raw - The job's metadata string.
 * @returns The ticket, or null when the metadata is not an object carrying one.
 */
function ticketFromMetadata(raw: string): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const ticket = (parsed as Record<string, unknown>).ticket;
    return typeof ticket === "string" && ticket.length > 0 ? ticket : null;
  } catch {
    return null;
  }
}

const agent = defineAgent<WorkerUserData>({
  prewarm: async (proc: JobProcess<WorkerUserData>) => {
    proc.userData.vad = await SileroVAD.load(VAD_OPTIONS);
  },

  entry: async (ctx: JobContext<WorkerUserData>) => {
    const logger = log();
    const vad = ctx.proc.userData.vad;
    if (!vad) throw new Error("Voice activity model was not prewarmed");

    const config = loadConfig();
    const ticket = ticketFromMetadata(ctx.job.metadata);
    if (!ticket) {
      logger.warn({ room: ctx.job.room?.name }, "dispatch carried no ticket");
      ctx.shutdown("no ticket");
      return;
    }

    const client = new NimbusClient({
      baseUrl: config.NIMBUS_API_URL,
      secret: config.NIMBUS_AGENT_SECRET,
      warn: (message) => logger.warn(message),
    });

    let redeemed;
    try {
      redeemed = await client.redeem(ticket);
    } catch {
      logger.error({ room: ctx.job.room?.name }, "ticket was not accepted");
      ctx.shutdown("ticket not accepted");
      return;
    }

    if (!isAllowedProviderUrl(redeemed.voice.baseUrl, config)) {
      logger.error(
        { meetingId: redeemed.meetingId },
        "refusing a non-HTTPS speech provider address",
      );
      await client.postEnded("agent-ended");
      ctx.shutdown("insecure provider address");
      return;
    }

    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    logger.info(
      { meetingId: redeemed.meetingId, members: redeemed.members.length },
      "agent joined the meeting",
    );

    const session = new MeetingSession(
      ctx.room as unknown as RoomLike,
      redeemed,
      {
        vad,
        client,
        clock: createMeetingClock(redeemed.startedAt),
        openFrames: framesOfTrack,
        // Leaving the room ends the job; going through `ctx.shutdown` instead
        // would re-enter the shutdown callback registered below and wait on it.
        disconnect: () => ctx.room.disconnect(),
        log: (message, fields) => logger.info(fields ?? {}, message),
      },
    );
    session.start();
    ctx.addShutdownCallback(() => session.stop("shutdown"));
  },
});

export default agent;

// Fail at start-up, naming the variable, rather than at the first dispatch.
loadConfig();

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: AGENT_NAME,
    // Each idle process holds its own Silero model (about 300 MB), and the
    // default of four would not fit the hosted plan's memory.
    numIdleProcesses: 1,
  }),
);
