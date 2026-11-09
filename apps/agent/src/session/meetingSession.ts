/**
 * @module agent/session/meetingSession
 * @description One agent session: wires a room's participants to the
 * transcript, and owns the session's lifetime.
 *
 * Every human's microphone gets its own listener. Finished utterances go to the
 * transcriber, ordered segments go to the API client, who is speaking is
 * reported to the API a couple of times a second, and the budget and
 * empty-room timers decide when the session ends by itself.
 *
 * @important `stop` is idempotent and always runs the same order: stop the
 *            listeners (which cuts any open utterance), wait for transcription
 *            to finish, flush the outbox, report usage, tell the API, and only
 *            then disconnect. Each wait is capped at five seconds, so a stuck
 *            provider or an unreachable API delays leaving but cannot prevent it.
 *
 * @important Speaker identity comes from the participant's LiveKit identity,
 *            which the API sets to the user id when it mints the token. The
 *            agent never infers who is speaking from the audio.
 */
import type { VAD } from "@livekit/agents";
import {
  ParticipantKind,
  RoomEvent,
  TrackKind,
  type RemoteAudioTrack,
} from "@livekit/rtc-node";
import type {
  EndedRequest,
  RedeemResponse,
  SegmentIn,
  UsageIn,
} from "@nimbus/types";
import type { NimbusClient } from "../api/nimbusClient.js";
import {
  listenToFrames,
  type ParticipantListener,
} from "../audio/participantListener.js";
import type { FrameSource } from "../audio/trackFrames.js";
import { MeetingBudget } from "../budget.js";
import { createGlossary } from "../stt/glossary.js";
import { Transcriber } from "../stt/transcriber.js";
import type { SttRequest, SttResult } from "../stt/openaiCompatibleStt.js";
import type { MeetingClock } from "./clock.js";

/** Why a session is ending. */
export type StopReason =
  | "server"
  | "budget"
  | "empty-room"
  | "invalid-key"
  | "shutdown";

const END_REASON: Record<StopReason, EndedRequest["reason"]> = {
  server: "stopped",
  budget: "budget",
  "empty-room": "agent-ended",
  "invalid-key": "invalid-key",
  shutdown: "agent-ended",
};

/** Longest each shutdown wait may take, in milliseconds. */
export const FLUSH_TIMEOUT_MS = 5000;

/** Least time between state posts, in milliseconds. */
export const STATE_INTERVAL_MS = 500;

/** How often usage is reported while the session runs, in milliseconds. */
export const USAGE_INTERVAL_MS = 10_000;

/** A remote participant, as far as the session needs them. */
export interface ParticipantLike {
  identity: string;
  name?: string;
  kind?: ParticipantKind;
  trackPublications?: Map<
    string,
    { track?: { kind?: TrackKind } | undefined }
  >;
}

/** The slice of a LiveKit room the session uses. */
export interface RoomLike {
  on(event: string, handler: (...args: never[]) => void): unknown;
  off(event: string, handler: (...args: never[]) => void): unknown;
  remoteParticipants: Map<string, ParticipantLike>;
  localParticipant?: { identity?: string } | undefined;
}

/** The client methods the session calls. */
export type SessionClient = Pick<
  NimbusClient,
  "queueSegment" | "flush" | "postState" | "postUsage" | "postEnded" | "onStop"
>;

/** Everything the session needs from outside. */
export interface SessionDeps {
  vad: VAD;
  client: SessionClient;
  clock: MeetingClock;
  /** Opens a subscribed track as frames; the real one uses the native stream. */
  openFrames(track: RemoteAudioTrack): FrameSource;
  /** Leaves the room. */
  disconnect(): void | Promise<void>;
  /** The transcription request. Tests only. */
  stt?: (request: SttRequest) => Promise<SttResult>;
  /** Reports a non-secret diagnostic. */
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

/** One agent session in one room. */
export class MeetingSession {
  private readonly room: RoomLike;
  private readonly redeemed: RedeemResponse;
  private readonly deps: SessionDeps;
  private readonly members = new Map<string, string>();
  private readonly listeners = new Map<string, ParticipantListener>();
  private readonly speaking = new Set<string>();
  private readonly usage: UsageIn[] = [];
  private readonly transcriber: Transcriber;
  private readonly budget: MeetingBudget;
  private readonly roomHandlers: Array<[string, (...args: never[]) => void]> = [];

  private stopPromise: Promise<void> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private usageTimer: ReturnType<typeof setInterval> | null = null;
  private lastStateAt = 0;
  private lastPostedSpeaking = "";

  constructor(room: RoomLike, redeemed: RedeemResponse, deps: SessionDeps) {
    this.room = room;
    this.redeemed = redeemed;
    this.deps = deps;
    for (const member of redeemed.members) {
      this.members.set(member.userId, member.name);
    }

    const names = redeemed.members.map((m) => m.name);
    this.transcriber = new Transcriber({
      baseUrl: redeemed.voice.baseUrl,
      apiKey: redeemed.voice.apiKey,
      model: redeemed.voice.transcribeModel,
      language: redeemed.voice.language,
      prompt: `Nimbus, NimbusBot, Excalidraw, LiveKit${names.length ? `, ${names.join(", ")}` : ""}`,
      glossary: createGlossary(names),
      stt: deps.stt,
      onSegment: (segment: SegmentIn) => deps.client.queueSegment(segment),
      onUsage: (entry) => {
        this.usage.push(entry);
      },
      onFatal: () => {
        void this.stop("invalid-key");
      },
    });

    const remainingMs =
      redeemed.budgetSeconds === null
        ? null
        : redeemed.budgetSeconds * 1000 - deps.clock.elapsedMs();
    this.budget = new MeetingBudget({
      remainingMs,
      onBudget: () => void this.stop("budget"),
      onEmptyRoom: () => void this.stop("empty-room"),
    });
  }

  /** Starts listening to everyone in the room, now and as they arrive. */
  start(): void {
    this.deps.client.onStop(() => void this.stop("server"));
    this.budget.start();

    this.onRoom(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      this.attach(participant, track as RemoteAudioTrack);
    });
    this.onRoom(RoomEvent.TrackUnsubscribed, (_track, _pub, participant) => {
      void this.detach((participant as ParticipantLike).identity);
    });
    this.onRoom(RoomEvent.ParticipantConnected, () => this.countHumans());
    this.onRoom(RoomEvent.ParticipantDisconnected, (participant) => {
      void this.detach((participant as ParticipantLike).identity);
      this.countHumans();
    });

    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications?.values() ?? []) {
        const track = publication.track as RemoteAudioTrack | undefined;
        if (track?.kind === TrackKind.KIND_AUDIO) this.attach(participant, track);
      }
    }
    this.countHumans();

    this.usageTimer = setInterval(() => void this.reportUsage(), USAGE_INTERVAL_MS);
    this.usageTimer.unref();
    void this.deps.client.postState({ state: "listening", speakingUserIds: [] });
  }

  private onRoom(event: string, handler: (...args: never[]) => void): void {
    this.room.on(event, handler);
    this.roomHandlers.push([event, handler]);
  }

  private isHuman(participant: ParticipantLike): boolean {
    return (
      participant.kind !== ParticipantKind.AGENT &&
      participant.identity !== this.room.localParticipant?.identity
    );
  }

  private countHumans(): void {
    let humans = 0;
    for (const participant of this.room.remoteParticipants.values()) {
      if (this.isHuman(participant)) humans += 1;
    }
    this.budget.setHumans(humans);
  }

  private attach(participant: ParticipantLike, track: RemoteAudioTrack): void {
    if (this.stopPromise || !this.isHuman(participant)) return;
    if (track.kind !== TrackKind.KIND_AUDIO) return;

    const identity = participant.identity;
    void this.listeners.get(identity)?.stop();

    const name = this.members.get(identity) ?? participant.name ?? identity;
    const source = this.deps.openFrames(track);
    this.listeners.set(
      identity,
      listenToFrames({
        frames: source.frames,
        closeSource: () => source.close(),
        vad: this.deps.vad,
        clock: this.deps.clock,
        handlers: {
          onSpeechStart: () => {
            this.speaking.add(identity);
            this.scheduleState();
          },
          onSpeechEnd: () => {
            this.speaking.delete(identity);
            this.scheduleState();
          },
          onUtterance: (utterance) => {
            this.transcriber.submit({
              userId: identity,
              name,
              startMs: utterance.startMs,
              endMs: utterance.endMs,
              pcm: utterance.pcm,
            });
          },
        },
      }),
    );
  }

  private async detach(identity: string): Promise<void> {
    const listener = this.listeners.get(identity);
    if (!listener) return;
    this.listeners.delete(identity);
    await listener.stop();
    this.speaking.delete(identity);
    this.scheduleState();
  }

  /** Posts the speaking set at most every `STATE_INTERVAL_MS`, when it changed. */
  private scheduleState(): void {
    if (this.stopPromise || this.stateTimer) return;
    const wait = Math.max(0, STATE_INTERVAL_MS - (Date.now() - this.lastStateAt));
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      const ids = [...this.speaking].sort();
      const key = ids.join(",");
      if (key === this.lastPostedSpeaking) return;
      this.lastPostedSpeaking = key;
      this.lastStateAt = Date.now();
      void this.deps.client.postState({
        state: "listening",
        speakingUserIds: ids,
      });
    }, wait);
  }

  private async reportUsage(): Promise<void> {
    if (this.usage.length === 0) return;
    const batch = this.usage.splice(0, this.usage.length);
    const stored = await this.deps.client.postUsage(batch);
    if (!stored) this.usage.unshift(...batch);
  }

  /**
   * Ends the session.
   *
   * @param reason - Why; reported to the API in its own vocabulary.
   */
  stop(reason: StopReason): Promise<void> {
    this.stopPromise ??= this.shutDown(reason);
    return this.stopPromise;
  }

  private async shutDown(reason: StopReason): Promise<void> {
    this.deps.log?.("stopping session", { reason });
    this.budget.stop();
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = null;
    if (this.usageTimer) clearInterval(this.usageTimer);
    this.usageTimer = null;
    for (const [event, handler] of this.roomHandlers) this.room.off(event, handler);
    this.roomHandlers.length = 0;

    await Promise.all([...this.listeners.values()].map((l) => l.stop()));
    this.listeners.clear();
    await this.transcriber.flush(FLUSH_TIMEOUT_MS);
    this.transcriber.close();
    await this.deps.client.flush(FLUSH_TIMEOUT_MS);
    await this.reportUsage();
    await this.deps.client.postEnded(END_REASON[reason]);
    await this.deps.disconnect();
  }
}
