/**
 * @module agent/__tests__/wav
 * @description The WAV encoder: header fields, byte length, and a round trip
 * through an independent parser.
 */
import { describe, expect, it } from "vitest";
import { WAV_HEADER_BYTES, encodeWav } from "../audio/wav.js";
import { parseWav } from "./helpers/audio.js";

describe("encodeWav", () => {
  const pcm = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);

  it("writes the canonical 44-byte PCM header", () => {
    const wav = encodeWav(pcm, 16_000);
    const view = new DataView(wav.buffer);
    const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));

    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(12)).toBe("fmt ");
    expect(tag(36)).toBe("data");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it("sizes the file and its chunks from the sample count", () => {
    const wav = encodeWav(pcm, 16_000);
    const view = new DataView(wav.buffer);

    expect(wav.byteLength).toBe(WAV_HEADER_BYTES + pcm.length * 2);
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(view.getUint32(40, true)).toBe(pcm.length * 2);
  });

  it("round-trips the samples through a parser", () => {
    const parsed = parseWav(encodeWav(pcm, 24_000));

    expect(parsed.sampleRate).toBe(24_000);
    expect(parsed.channels).toBe(1);
    expect(parsed.bits).toBe(16);
    expect([...parsed.pcm]).toEqual([...pcm]);
  });

  it("records the channel count in the rate fields", () => {
    const wav = encodeWav(Int16Array.from([1, 2, 3, 4]), 16_000, 2);
    const view = new DataView(wav.buffer);

    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(28, true)).toBe(64_000);
    expect(view.getUint16(32, true)).toBe(4);
  });

  it("encodes an empty clip as a header alone", () => {
    expect(encodeWav(new Int16Array(0), 16_000).byteLength).toBe(
      WAV_HEADER_BYTES,
    );
  });
});
