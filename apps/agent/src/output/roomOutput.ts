/**
 * @module agent/output/roomOutput
 * @description Publishes the assistant's voice: one local audio track, named
 * `nimbus-voice`, fed from an `AudioSource`, and the {@link AudioOutput} the
 * speaker writes to.
 *
 * @important The track is published once, when the session starts, at a fixed
 *            rate ({@link OUTPUT_SAMPLE_RATE}). Speech models return PCM at
 *            their own rate (44.1 kHz for some, 24 kHz for others, stated per
 *            response), so frames at any other rate go through a native
 *            resampler kept per input rate. This is the only module that
 *            touches the native audio source; everything above it is testable
 *            with a fake output.
 */
import {
  AudioFrame,
  AudioResampler,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  type LocalParticipant,
} from "@livekit/rtc-node";
import { AGENT_VOICE_TRACK } from "../sharedConstants.js";
import type { AudioOutput } from "./speaker.js";

/** The rate the published track runs at. */
export const OUTPUT_SAMPLE_RATE = 48_000;

/** Audio the source may hold before `captureFrame` waits, in milliseconds. */
const QUEUE_MS = 1000;

/** A published voice track and the means to take it down. */
export type RoomOutput = AudioOutput & { close(): Promise<void> };

/**
 * Publishes the assistant's voice track.
 *
 * @param participant - The agent's local participant in the room.
 * @returns The output the speaker writes to.
 */
export async function publishVoice(
  participant: LocalParticipant,
): Promise<RoomOutput> {
  const source = new AudioSource(OUTPUT_SAMPLE_RATE, 1, QUEUE_MS);
  const track = LocalAudioTrack.createAudioTrack(AGENT_VOICE_TRACK, source);
  const publication = await participant.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );
  const resamplers = new Map<number, AudioResampler>();

  const resamplerFor = (rate: number) => {
    let resampler = resamplers.get(rate);
    if (!resampler) {
      resampler = new AudioResampler(rate, OUTPUT_SAMPLE_RATE, 1);
      resamplers.set(rate, resampler);
    }
    return resampler;
  };

  return {
    async captureFrame(samples, sampleRate) {
      const frame = new AudioFrame(samples, sampleRate, 1, samples.length);
      if (sampleRate === OUTPUT_SAMPLE_RATE) {
        await source.captureFrame(frame);
        return;
      }
      for (const out of resamplerFor(sampleRate).push(frame)) {
        await source.captureFrame(out);
      }
    },
    clearQueue() {
      source.clearQueue();
    },
    waitForPlayout() {
      return source.waitForPlayout();
    },
    async close() {
      for (const resampler of resamplers.values()) resampler.close();
      resamplers.clear();
      if (publication.sid) {
        await participant
          .unpublishTrack(publication.sid)
          .catch(() => undefined);
      }
      await source.close().catch(() => undefined);
    },
  };
}
