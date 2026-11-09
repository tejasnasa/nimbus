/**
 * @module agent/__tests__/helpers/audio
 * @description Test helpers: reading the bundled WAV fixtures, cutting them
 * into the frames a track delivers, and a clock that follows the samples.
 */
import { AudioFrame } from "@livekit/rtc-node";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MeetingClock } from "../../session/clock.js";

/** Samples per frame the helpers cut audio into (10 ms at 16 kHz). */
export const FRAME_SAMPLES = 160;

/** Parses a WAV file's PCM payload by walking its chunks. */
export function parseWav(bytes: Uint8Array): {
  sampleRate: number;
  channels: number;
  bits: number;
  pcm: Int16Array;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");

  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === "data") {
      const pcm = new Int16Array(size / 2);
      for (let i = 0; i < pcm.length; i++) {
        pcm[i] = view.getInt16(offset + 8 + i * 2, true);
      }
      return { sampleRate, channels, bits, pcm };
    }
    offset += 8 + size + (size & 1);
  }
  throw new Error("WAV file has no data chunk");
}

/** Reads a fixture from `src/__tests__/fixtures` as 16 kHz mono samples. */
export function readFixture(name: string): Int16Array {
  const path = resolve(import.meta.dirname, "../fixtures", name);
  return parseWav(readFileSync(path)).pcm;
}

/** Digital silence of a given length. */
export function silence(seconds: number): Int16Array {
  return new Int16Array(Math.round(seconds * 16_000));
}

/** Joins clips end to end. */
export function concat(...clips: Int16Array[]): Int16Array {
  const out = new Int16Array(clips.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const clip of clips) {
    out.set(clip, offset);
    offset += clip.length;
  }
  return out;
}

/** Cuts samples into frames the way a track delivers them. */
export function toFrames(pcm: Int16Array): AudioFrame[] {
  const frames: AudioFrame[] = [];
  for (let i = 0; i + FRAME_SAMPLES <= pcm.length; i += FRAME_SAMPLES) {
    frames.push(
      new AudioFrame(pcm.slice(i, i + FRAME_SAMPLES), 16_000, 1, FRAME_SAMPLES),
    );
  }
  return frames;
}

/**
 * A frame source that yields to the event loop now and then, so a voice
 * activity stream running alongside can keep up as it would in real time.
 */
export async function* paced(
  frames: AudioFrame[],
  every = 50,
): AsyncGenerator<AudioFrame> {
  let n = 0;
  for (const frame of frames) {
    yield frame;
    if (++n % every === 0) await new Promise((r) => setTimeout(r, 1));
  }
}

/** A clock that advances 10 ms each time a frame asks for the time. */
export function frameClock(startMs = 0): MeetingClock {
  let now = startMs;
  return {
    elapsedMs: () => {
      now += 10;
      return now;
    },
  };
}
