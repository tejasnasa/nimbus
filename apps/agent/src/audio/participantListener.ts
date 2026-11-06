/**
 * @module agent/audio/participantListener
 * @description Turns one participant's published microphone track into voice
 *              activity events.
 *
 * Each remote audio track gets its own resampled `AudioStream` and its own VAD
 * stream, so two people talking at once are segmented independently.
 *
 * @important Frames are requested at 16 kHz mono from the track itself, so no
 *            resampling happens in this process. The returned function stops
 *            the pump and closes the VAD stream; it must be called when the
 *            track is unsubscribed or the participant leaves.
 */
import { VADEventType, type VAD, type VADEvent } from "@livekit/agents";
import {
  AudioStream,
  type RemoteAudioTrack,
  type RemoteParticipant,
} from "@livekit/rtc-node";

/** Sample rate the voice activity model consumes. */
export const LISTEN_SAMPLE_RATE = 16_000;

/** Callbacks fired as a participant starts and stops speaking. */
export interface ListenerHandlers {
  onSpeechStart(participant: RemoteParticipant, event: VADEvent): void;
  onSpeechEnd(participant: RemoteParticipant, event: VADEvent): void;
}

/**
 * Starts listening to a participant's audio track.
 *
 * @param track - The subscribed remote audio track.
 * @param participant - Its owner, passed back to the handlers.
 * @param vad - A loaded voice activity detector, shared across participants.
 * @param handlers - Speech start and end callbacks.
 * @returns A function that stops listening.
 */
export function listenToParticipant(
  track: RemoteAudioTrack,
  participant: RemoteParticipant,
  vad: VAD,
  handlers: ListenerHandlers,
): () => void {
  const audio = new AudioStream(track, {
    sampleRate: LISTEN_SAMPLE_RATE,
    numChannels: 1,
  });
  const stream = vad.stream();
  let stopped = false;

  const pump = async () => {
    const reader = audio.getReader();
    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        stream.pushFrame(value);
      }
    } finally {
      reader.releaseLock();
      // `endInput()` throws while the stream's own writer holds the lock, so a
      // flush marks the segment boundary and `stop()` closes the stream.
      if (!stopped) stream.flush();
    }
  };

  const consume = async () => {
    for await (const event of stream) {
      if (event.type === VADEventType.START_OF_SPEECH) {
        handlers.onSpeechStart(participant, event);
      } else if (event.type === VADEventType.END_OF_SPEECH) {
        handlers.onSpeechEnd(participant, event);
      }
    }
  };

  void pump().catch(() => stream.close());
  void consume().catch(() => undefined);

  return () => {
    stopped = true;
    stream.close();
    void audio.cancel().catch(() => undefined);
  };
}
