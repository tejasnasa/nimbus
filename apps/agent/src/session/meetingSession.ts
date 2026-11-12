/**
 * @module agent/session/meetingSession
 * @description One agent session: wires a room's participants to the
 * transcript and to the assistant's voice, and owns the session's lifetime.
 *
 * Every human's microphone gets its own listener. Finished utterances go to the
 * transcriber, ordered segments go to the API client, who is speaking is
 * reported to the API a couple of times a second, and the budget and
 * empty-room timers decide when the session ends by itself.
 *
 * A segment addressed to the assistant (by wake phrase, a bare wake word's
 * window, or the Ask button) is answered: the API streams the reply and the
 * speaker plays it on the agent's own track, or, when the assistant may not
 * speak, the API posts it to chat. Browsers reach the session through two RPC
 * methods: `nimbus.ask` (the Ask button, held and released) and `nimbus.stop`.
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
 *
 * @important One answer at a time. A new addressed segment cancels the answer
 *            in progress, whether it is still thinking or already speaking, and
 *            a person talking over the assistant for long enough interrupts it
 *            (see `bargeIn`). An interrupted answer is never resumed.
 *
 * @important Answering never throws into the session. A failed or refused answer
 *            returns the assistant to listening; a rejected speech key turns the
 *            voice off for the rest of the session, and later answers go to chat.
 */
import type { VAD } from "@livekit/agents";
import {
  ParticipantKind,
  RoomEvent,
  TrackKind,
  type RemoteAudioTrack,
} from "@livekit/rtc-node";
import type {
  AgentNoticeKind,
  EndedRequest,
  RedeemResponse,
  SegmentIn,
  StateRequest,
  UsageIn,
} from "@nimbus/types";
import { Addressing } from "../addressing.js";
import type { NimbusClient } from "../api/nimbusClient.js";
import {
  AGENT_NOTICE_TEXT,
  AGENT_RPC_ASK,
  AGENT_RPC_STOP,
} from "../sharedConstants.js";
import {
  listenToFrames,
  type ParticipantListener,
} from "../audio/participantListener.js";
import type { FrameSource } from "../audio/trackFrames.js";
import { BargeIn } from "../bargeIn.js";
import { MeetingBudget } from "../budget.js";
import { Speaker, type AudioOutput } from "../output/speaker.js";
import { createGlossary } from "../stt/glossary.js";
import { Transcriber } from "../stt/transcriber.js";
import type { SttRequest, SttResult } from "../stt/openaiCompatibleStt.js";
import {
  synthesize,
  TtsError,
  type TtsAudio,
  type TtsRequest,
} from "../tts/openaiCompatibleTts.js";
import { VAD_OPTIONS } from "../vadOptions.js";
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

/** Silence that ends a turn while the Ask button is held, in milliseconds. */
export const ASK_SILENCE_MS = 400;

/** Longest wait for the addressed caption to reach the API, in milliseconds. */
export const ANSWER_FLUSH_MS = 1500;

/** How long "answered in chat" shows before the assistant reads as listening. */
export const CHAT_STATE_HOLD_MS = 4000;

/** Longest a spoken notice may delay leaving, in milliseconds. */
export const NOTICE_TIMEOUT_MS = 8000;

/** A remote participant, as far as the session needs them. */
export interface ParticipantLike {
  identity: string;
  name?: string;
  kind?: ParticipantKind;
  trackPublications?: Map<string, { track?: { kind?: TrackKind } | undefined }>;
}

/** What an RPC handler receives, as far as the session reads it. */
export type RpcCall = { callerIdentity: string; payload: string };

/** The agent's own participant, as far as the session needs it. */
export type LocalParticipantLike = {
  identity?: string;
  registerRpcMethod?(
    method: string,
    handler: (data: RpcCall) => Promise<string>,
  ): void;
  unregisterRpcMethod?(method: string): void;
};

/** The slice of a LiveKit room the session uses. */
export interface RoomLike {
  on(event: string, handler: (...args: never[]) => void): unknown;
  off(event: string, handler: (...args: never[]) => void): unknown;
  remoteParticipants: Map<string, ParticipantLike>;
  localParticipant?: LocalParticipantLike | undefined;
}

/** The client methods the session calls. */
export type SessionClient = Pick<
  NimbusClient,
  | "queueSegment"
  | "flush"
  | "postState"
  | "postUsage"
  | "postEnded"
  | "onStop"
  | "answer"
  | "postNotice"
>;

/** The assistant's voice track: frames in, and a way to take it down. */
export type VoiceOutput = AudioOutput & { close?(): Promise<void> };

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
  /**
   * Publishes the assistant's voice track. Called once at start when the
   * session may speak; without it, answers go to chat.
   */
  openVoice?: () => Promise<VoiceOutput>;
  /** The speech request. Tests only. */
  tts?: (request: TtsRequest) => Promise<TtsAudio>;
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
  private readonly addressing: Addressing;
  private readonly bargeIn: BargeIn;
  private readonly roomHandlers: Array<[string, (...args: never[]) => void]> =
    [];
  private readonly rpcMethods: string[] = [];

  private stopPromise: Promise<void> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private usageTimer: ReturnType<typeof setInterval> | null = null;
  private lastStateAt = 0;
  private lastPostedSpeaking = "";

  private voice: VoiceOutput | null = null;
  private speaker: Speaker | null = null;
  private answering: AbortController | null = null;
  private assistantState: StateRequest["state"] = "listening";
  private chatStateTimer: ReturnType<typeof setTimeout> | null = null;

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
      onSegment: (segment: SegmentIn, asked: boolean) =>
        this.onSegment(segment, asked),
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
      onBudget: () => void this.endOfBudget(),
      onEmptyRoom: () => void this.stop("empty-room"),
      onWarning: () => void this.notice("budget-warning"),
    });
    this.addressing = new Addressing({
      wakeNames: redeemed.wakeNames,
      onAskCancelled: (identity) => this.setAskSilence(identity, false),
    });
    this.bargeIn = new BargeIn({
      isSpeaking: () => this.speaker?.speaking ?? false,
      interrupt: () => this.interrupt(),
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
        if (track?.kind === TrackKind.KIND_AUDIO)
          this.attach(participant, track);
      }
    }
    this.countHumans();

    this.usageTimer = setInterval(
      () => void this.reportUsage(),
      USAGE_INTERVAL_MS,
    );
    this.usageTimer.unref();
    void this.deps.client.postState({
      state: "listening",
      speakingUserIds: [],
    });

    this.registerRpc(AGENT_RPC_ASK, async (call) => {
      let pressed = false;
      try {
        pressed =
          (JSON.parse(call.payload) as { pressed?: unknown } | null)
            ?.pressed === true;
      } catch {
        // A malformed payload reads as a release.
      }
      this.ask(call.callerIdentity, pressed);
      return JSON.stringify({ ok: true });
    });
    this.registerRpc(AGENT_RPC_STOP, async () => {
      this.interrupt();
      return JSON.stringify({ ok: true });
    });

    const { speechModel } = this.redeemed.voice;
    if (this.redeemed.assistantSpeaks && speechModel && this.deps.openVoice) {
      void this.openVoice();
    }
  }

  private onRoom(event: string, handler: (...args: never[]) => void): void {
    this.room.on(event, handler);
    this.roomHandlers.push([event, handler]);
  }

  private registerRpc(
    method: string,
    handler: (call: RpcCall) => Promise<string>,
  ): void {
    const local = this.room.localParticipant;
    if (!local?.registerRpcMethod) return;
    local.registerRpcMethod(method, handler);
    this.rpcMethods.push(method);
  }

  /** Publishes the voice track and builds the speaker on it. */
  private async openVoice(): Promise<void> {
    try {
      const output = await this.deps.openVoice!();
      if (this.stopPromise) {
        await output.close?.();
        return;
      }
      this.voice = output;
      const { baseUrl, apiKey, speechModel, voice } = this.redeemed.voice;
      this.speaker = new Speaker({
        output,
        onState: (state) => this.setState(state),
        synthesize: async (input, signal) => {
          try {
            return await (this.deps.tts ?? synthesize)({
              baseUrl,
              apiKey,
              model: speechModel!,
              voice,
              input,
              signal,
              onUsage: (entry) => {
                this.usage.push(entry);
              },
            });
          } catch (error) {
            if (error instanceof TtsError && error.kind === "auth") {
              // Every later sentence would be refused the same way.
              this.deps.log?.("speech key refused; answering in chat");
              this.speaker = null;
            }
            throw error;
          }
        },
      });
    } catch {
      this.deps.log?.("could not publish the voice track; answering in chat");
    }
  }

  /** The Ask button, pressed or released by a person in the call. */
  private ask(identity: string, pressed: boolean): void {
    if (this.stopPromise) return;
    if (pressed && this.speaker?.busy) this.interrupt();
    this.addressing.setPressed(identity, pressed);
    this.setAskSilence(identity, pressed);
  }

  /** Shortens a person's end-of-turn silence while they hold the Ask button. */
  private setAskSilence(identity: string, pressed: boolean): void {
    this.listeners
      .get(identity)
      ?.setMinSilence(
        pressed ? ASK_SILENCE_MS : VAD_OPTIONS.minSilenceDuration,
      );
  }

  /** Stops whatever the assistant is doing and returns it to listening. */
  interrupt(): void {
    this.cancelAnswer();
    this.setState("listening");
  }

  /** Cancels the answer in progress, thinking or speaking, if any. */
  private cancelAnswer(): void {
    this.answering?.abort();
    this.answering = null;
    this.speaker?.interrupt();
  }

  /** A transcribed segment, in order: post it, and answer it if addressed. */
  private onSegment(segment: SegmentIn, asked: boolean): void {
    const decision = this.addressing.classify(
      segment.speakerUserId,
      segment.text,
      asked,
    );
    const posted = decision.addressed
      ? { ...segment, addressed: true }
      : segment;
    this.deps.client.queueSegment(posted);
    if (this.stopPromise || !decision.addressed) return;
    if (decision.wakeOnly) {
      void this.speaker?.chime();
      return;
    }
    void this.answer(posted);
  }

  /** Records and reports what the assistant is doing. */
  private setState(state: StateRequest["state"]): void {
    if (this.chatStateTimer) clearTimeout(this.chatStateTimer);
    this.chatStateTimer = null;
    if (state === this.assistantState || this.stopPromise) return;
    this.assistantState = state;
    void this.deps.client.postState({
      state,
      speakingUserIds: [...this.speaking].sort(),
    });
  }

  /** Answers one addressed segment. Never throws. */
  private async answer(segment: SegmentIn): Promise<void> {
    this.cancelAnswer();
    const controller = new AbortController();
    this.answering = controller;
    const speaker = this.speaker;
    this.setState("thinking");

    const outcome: { channel: "voice" | "chat" | null } = { channel: null };
    try {
      await this.deps.client.flush(ANSWER_FLUSH_MS);
      if (controller.signal.aborted) return;
      const replySeq = this.transcriber.reserveSeq();
      const lines = this.deps.client.answer(
        { seq: segment.seq, replySeq, speak: speaker !== null },
        controller.signal,
      );

      if (speaker) {
        const text = (async function* () {
          for await (const line of lines) {
            if (line.type === "delta") yield line.text;
            else if (line.type === "done") outcome.channel = line.channel;
          }
        })();
        await speaker.speak(text, controller.signal);
      } else {
        for await (const line of lines) {
          if (line.type === "done") outcome.channel = line.channel;
        }
      }
    } catch {
      // Answering degrades to listening; see the module notes.
    } finally {
      if (this.answering === controller) {
        this.answering = null;
        if (outcome.channel === "chat") this.holdChatState();
        else this.setState("listening");
      }
    }
  }

  /**
   * The API has told the call the answer went to chat. That state shows for a
   * moment, then the assistant reads as listening again.
   */
  private holdChatState(): void {
    this.assistantState = "listening";
    this.chatStateTimer = setTimeout(() => {
      this.chatStateTimer = null;
      if (this.stopPromise) return;
      void this.deps.client.postState({
        state: "listening",
        speakingUserIds: [...this.speaking].sort(),
      });
    }, CHAT_STATE_HOLD_MS);
  }

  /**
   * Tells the call about its free time: spoken when the assistant has a voice
   * and is not mid-answer (the final notice interrupts one), otherwise posted
   * to chat.
   */
  private async notice(kind: AgentNoticeKind): Promise<void> {
    if (this.stopPromise) return;
    const speaker = this.speaker;
    if (speaker && (!speaker.busy || kind === "budget-ended")) {
      if (kind === "budget-ended") this.interrupt();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        speaker.say(AGENT_NOTICE_TEXT[kind]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, NOTICE_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);
      return;
    }
    await this.deps.client.postNotice(kind);
  }

  /** The free time is over: say so, then leave. */
  private async endOfBudget(): Promise<void> {
    await this.notice("budget-ended").catch(() => undefined);
    await this.stop("budget");
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
            this.bargeIn.speechStarted(identity);
            this.scheduleState();
          },
          onSpeechEnd: () => {
            this.speaking.delete(identity);
            this.bargeIn.speechEnded(identity);
            this.scheduleState();
          },
          onUtterance: (utterance) => {
            this.transcriber.submit({
              userId: identity,
              name,
              startMs: utterance.startMs,
              endMs: utterance.endMs,
              pcm: utterance.pcm,
              asked: this.addressing.markAsk(identity),
            });
          },
        },
      }),
    );
    if (this.addressing.isPressed(identity)) this.setAskSilence(identity, true);
  }

  private async detach(identity: string): Promise<void> {
    const listener = this.listeners.get(identity);
    if (!listener) return;
    this.listeners.delete(identity);
    await listener.stop();
    this.speaking.delete(identity);
    this.bargeIn.speechEnded(identity);
    this.scheduleState();
  }

  /** Posts the speaking set at most every `STATE_INTERVAL_MS`, when it changed. */
  private scheduleState(): void {
    if (this.stopPromise || this.stateTimer) return;
    const wait = Math.max(
      0,
      STATE_INTERVAL_MS - (Date.now() - this.lastStateAt),
    );
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      const ids = [...this.speaking].sort();
      const key = ids.join(",");
      if (key === this.lastPostedSpeaking) return;
      this.lastPostedSpeaking = key;
      this.lastStateAt = Date.now();
      void this.deps.client.postState({
        state: this.assistantState,
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
    this.bargeIn.stop();
    this.addressing.close();
    this.cancelAnswer();
    this.speaker = null;
    if (this.chatStateTimer) clearTimeout(this.chatStateTimer);
    this.chatStateTimer = null;
    for (const method of this.rpcMethods) {
      this.room.localParticipant?.unregisterRpcMethod?.(method);
    }
    this.rpcMethods.length = 0;
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = null;
    if (this.usageTimer) clearInterval(this.usageTimer);
    this.usageTimer = null;
    for (const [event, handler] of this.roomHandlers)
      this.room.off(event, handler);
    this.roomHandlers.length = 0;

    await Promise.all([...this.listeners.values()].map((l) => l.stop()));
    this.listeners.clear();
    await this.transcriber.flush(FLUSH_TIMEOUT_MS);
    this.transcriber.close();
    await this.deps.client.flush(FLUSH_TIMEOUT_MS);
    await this.reportUsage();
    await this.deps.client.postEnded(END_REASON[reason]);
    await this.voice?.close?.().catch(() => undefined);
    this.voice = null;
    await this.deps.disconnect();
  }
}
