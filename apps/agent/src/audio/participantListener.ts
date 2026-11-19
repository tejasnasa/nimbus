/**
 * @module agent/audio/participantListener
 * @description Turns one participant's stream of audio frames into utterances.
 *
 * Every participant gets their own voice activity stream and their own
 * utterance buffer, so two people talking at once are segmented independently
 * and each utterance keeps the identity of the person who spoke it.
 *
 * @important Frames are pushed to the buffer before the detector sees them, and
 *            the detector's events arrive later, carrying the index of the
 *            sample they refer to. The buffer cuts by that index, so the order
 *            matters and the detector may run arbitrarily far behind.
 *
 * @important `endInput()` on a detector stream throws while the stream's own
 *            writer holds the lock, so the stream is closed with `close()`.
 *            Stopping cuts any open utterance first: a participant who leaves
 *            mid-sentence still gets their caption.
 */
import { VADEventType, type VAD } from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";
import type { MeetingClock } from "../session/clock.js";
import {
  UtteranceBuffer,
  type Utterance,
  type UtteranceBufferOptions,
} from "./utteranceBuffer.js";

/** Sample rate the voice activity model consumes. */
export const LISTEN_SAMPLE_RATE = 16_000;

/** Callbacks fired as a participant speaks. */
export interface ListenerHandlers {
  onSpeechStart(): void;
  onSpeechEnd(): void;
  /** A finished utterance, ready to transcribe. */
  onUtterance(utterance: Utterance): void;
}

/** Everything a listener needs; the audio source is injected. */
export interface ListenerInput {
  /** Mono 16 kHz frames, in order. */
  frames: AsyncIterable<AudioFrame>;
  /** Releases the source when the listener stops. */
  closeSource?: () => void | Promise<void>;
  vad: VAD;
  clock: MeetingClock;
  handlers: ListenerHandlers;
  bufferOptions?: UtteranceBufferOptions;
}

/** A running listener. */
export interface ParticipantListener {
  /** Stops listening, cutting any open utterance. Safe to call more than once. */
  stop(): Promise<void>;
}

/**
 * Starts listening to a stream of frames.
 *
 * @param input - The frames, the shared detector, the clock and the callbacks.
 * @returns A handle to stop listening.
 */
export function listenToFrames(input: ListenerInput): ParticipantListener {
  const { frames, vad, clock, handlers } = input;
  const buffer = new UtteranceBuffer({
    sampleRate: LISTEN_SAMPLE_RATE,
    ...input.bufferOptions,
  });
  const stream = vad.stream();
  let stopped = false;

  const deliver = (utterance: Utterance | null) => {
    if (utterance) handlers.onUtterance(utterance);
  };

  const pump = async () => {
    for await (const frame of frames) {
      if (stopped) break;
      for (const cut of buffer.pushFrame(frame.data, clock.elapsedMs())) {
        deliver(cut);
      }
      stream.pushFrame(frame);
    }
  };

  const consume = async () => {
    for await (const event of stream) {
      if (stopped) break;
      if (event.type === VADEventType.START_OF_SPEECH) {
        buffer.startSpeech(event.samplesIndex);
        handlers.onSpeechStart();
      } else if (event.type === VADEventType.END_OF_SPEECH) {
        const utterance = buffer.endSpeech(event.samplesIndex);
        handlers.onSpeechEnd();
        deliver(utterance);
      }
    }
  };

  const pumping = pump()
    .catch(() => undefined)
    .finally(() => {
      if (!stopped) stream.flush();
    });
  void consume().catch(() => undefined);

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      const open = buffer.speaking;
      deliver(buffer.flush());
      if (open) handlers.onSpeechEnd();
      stream.close();
      await input.closeSource?.();
      await pumping;
    },
  };
}
