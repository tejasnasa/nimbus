/**
 * @module agent/audio/trackFrames
 * @description Adapts a subscribed LiveKit audio track to the plain frame
 * stream the listener consumes.
 *
 * @important Frames are requested at 16 kHz mono from the track itself, so no
 *            resampling happens in this process. This is the only module that
 *            touches the native audio stream; everything above it is testable
 *            with synthetic frames.
 */
import {
  AudioStream,
  type AudioFrame,
  type RemoteAudioTrack,
} from "@livekit/rtc-node";
import { LISTEN_SAMPLE_RATE } from "./participantListener.js";

/** A frame source and the means to release it. */
export interface FrameSource {
  frames: AsyncIterable<AudioFrame>;
  close(): Promise<void>;
}

/**
 * Opens a track as a stream of 16 kHz mono frames.
 *
 * @param track - A subscribed remote audio track.
 */
export function framesOfTrack(track: RemoteAudioTrack): FrameSource {
  const stream = new AudioStream(track, {
    sampleRate: LISTEN_SAMPLE_RATE,
    numChannels: 1,
  });
  const reader = stream.getReader();

  async function* frames(): AsyncGenerator<AudioFrame> {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  return {
    frames: frames(),
    close: async () => {
      await reader.cancel().catch(() => undefined);
    },
  };
}
