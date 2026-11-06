/**
 * @module agent/index
 * @description LiveKit worker definition: prewarm, entry and the agent name.
 *
 * Joins a room only when dispatched by name, listens to every human audio
 * track separately, and exposes the `nimbus.ask` RPC method to browsers.
 *
 * @important `agentName` switches the worker to explicit dispatch, so it never
 *            joins a room on its own; the API creates the dispatch and carries
 *            a one-time ticket in the dispatch metadata, nothing else. The
 *            room is joined audio-only. The Silero model is loaded once per
 *            process in `prewarm`, because loading it per job would add its
 *            start-up time to every meeting.
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
import {
  ParticipantKind,
  RoomEvent,
  TrackKind,
  type RemoteAudioTrack,
  type RpcInvocationData,
} from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import { listenToParticipant } from "./audio/participantListener.js";

/** Name the API passes when it dispatches the agent to a room. */
export const AGENT_NAME = "nimbus";

/**
 * Voice activity settings; tuned against recorded speech before being fixed.
 * The Silero plugin takes its durations in milliseconds, not seconds.
 */
const VAD_OPTIONS = {
  minSpeechDuration: 250,
  minSilenceDuration: 600,
  prefixPaddingDuration: 300,
  activationThreshold: 0.5,
  sampleRate: 16_000 as const,
};

interface WorkerUserData extends Record<string, unknown> {
  vad?: VAD;
}

/**
 * Parses the dispatch metadata, which must be a JSON object.
 *
 * @param raw - The job's metadata string.
 * @returns The parsed object, or null when it is empty or not an object.
 */
function parseDispatchMetadata(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
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

    const metadata = parseDispatchMetadata(ctx.job.metadata);
    logger.info(
      {
        room: ctx.job.room?.name,
        hasTicket: typeof metadata?.ticket === "string",
      },
      "agent dispatched",
    );

    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);

    const stops = new Map<string, () => void>();

    ctx.room.on(
      RoomEvent.TrackSubscribed,
      (track, _publication, participant) => {
        if (track.kind !== TrackKind.KIND_AUDIO) return;
        if (participant.kind === ParticipantKind.AGENT) return;
        stops.get(participant.identity)?.();
        stops.set(
          participant.identity,
          listenToParticipant(track as RemoteAudioTrack, participant, vad, {
            onSpeechStart: (who) =>
              logger.info({ who: who.identity }, "speech start"),
            onSpeechEnd: (who, event) =>
              logger.info(
                { who: who.identity, seconds: event.speechDuration },
                "speech end",
              ),
          }),
        );
      },
    );

    ctx.room.on(
      RoomEvent.TrackUnsubscribed,
      (_track, _publication, participant) => {
        stops.get(participant.identity)?.();
        stops.delete(participant.identity);
      },
    );

    ctx.room.localParticipant?.registerRpcMethod(
      "nimbus.ask",
      async (data: RpcInvocationData) => {
        logger.info({ caller: data.callerIdentity }, "nimbus.ask");
        return JSON.stringify({ ok: true });
      },
    );

    ctx.addShutdownCallback(async () => {
      for (const stop of stops.values()) stop();
      stops.clear();
    });
  },
});

export default agent;

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: AGENT_NAME,
    // Each idle process holds its own Silero model (about 300 MB), and the
    // default of four would not fit the hosted plan's memory.
    numIdleProcesses: 1,
  }),
);
