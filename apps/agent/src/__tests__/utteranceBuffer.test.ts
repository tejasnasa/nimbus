/**
 * @module agent/__tests__/utteranceBuffer
 * @description Cutting utterances out of a frame stream by the detector's sample
 * indices: lead-in, tail, the force-cut, the minimum, and meeting-relative times.
 *
 * Audio here is synthetic and constant, so a sample's value says where it came
 * from and the cuts can be checked exactly.
 */
import { describe, expect, it } from "vitest";
import {
  UtteranceBuffer,
  type Utterance,
} from "../audio/utteranceBuffer.js";

const RATE = 16_000;
const FRAME = 160; // 10 ms
const ms = (n: number) => Math.round((n / 1000) * RATE);

/** Feeds `seconds` of audio whose every sample equals `value`. */
function feed(
  buffer: UtteranceBuffer,
  seconds: number,
  value: number,
  clock: { ms: number },
): Utterance[] {
  const cuts: Utterance[] = [];
  for (let i = 0; i < Math.round(seconds * 100); i++) {
    clock.ms += 10;
    cuts.push(...buffer.pushFrame(new Int16Array(FRAME).fill(value), clock.ms));
  }
  return cuts;
}

const count = (pcm: Int16Array, value: number) =>
  pcm.filter((v) => v === value).length;

describe("UtteranceBuffer", () => {
  it("includes the lead-in before the start event and trims the silence after speech", () => {
    const buffer = new UtteranceBuffer();
    const clock = { ms: 0 };
    feed(buffer, 1, 1, clock); // silence, marked 1
    feed(buffer, 2, 2, clock); // speech, marked 2 (1.0 s to 3.0 s)
    feed(buffer, 1, 3, clock); // trailing silence, marked 3

    // The detector fires its start 250 ms into the speech, and its end 600 ms
    // after the speech stopped.
    buffer.startSpeech(ms(1250));
    const utterance = buffer.endSpeech(ms(3600));

    expect(utterance).not.toBeNull();
    const pcm = utterance!.pcm;
    // 300 ms of lead-in: samples marked 1 come first.
    expect(pcm[0]).toBe(1);
    expect(count(pcm, 1)).toBe(ms(300));
    // The speech is all there.
    expect(count(pcm, 2)).toBe(ms(2000));
    // 600 ms of detector silence trimmed back to a 200 ms tail.
    expect(count(pcm, 3)).toBe(ms(200));
    expect(pcm.length).toBe(ms(300 + 2000 + 200));
  });

  it("stamps times relative to the meeting from the clock the frames carried", () => {
    const buffer = new UtteranceBuffer();
    const clock = { ms: 60_000 }; // the agent joined a minute into the meeting
    feed(buffer, 1, 1, clock);
    feed(buffer, 2, 2, clock);
    feed(buffer, 1, 3, clock);
    buffer.startSpeech(ms(1250));
    const utterance = buffer.endSpeech(ms(3600))!;

    // Lead-in begins 0.7 s into the stream, which was 60.7 s into the meeting.
    expect(utterance.startMs).toBeCloseTo(60_700, -1);
    expect(utterance.endMs).toBeCloseTo(60_000 + 3200, -1);
    expect(utterance.endMs - utterance.startMs).toBeCloseTo(2500, -1);
  });

  it("follows the wall clock across a gap in frames", () => {
    const buffer = new UtteranceBuffer();
    const clock = { ms: 0 };
    feed(buffer, 1, 1, clock);
    clock.ms += 30_000; // muted for half a minute: no frames arrive
    feed(buffer, 2, 2, clock);
    feed(buffer, 1, 3, clock);
    buffer.startSpeech(ms(2250));
    const utterance = buffer.endSpeech(ms(4600))!;

    expect(utterance.startMs).toBeGreaterThan(30_000);
  });

  it("copes with a detector that is far behind the audio", () => {
    const buffer = new UtteranceBuffer();
    const clock = { ms: 0 };
    feed(buffer, 1, 1, clock);
    feed(buffer, 2, 2, clock);
    feed(buffer, 4, 3, clock); // four more seconds arrive before the events do

    buffer.startSpeech(ms(1250));
    const utterance = buffer.endSpeech(ms(3600))!;

    expect(count(utterance.pcm, 2)).toBe(ms(2000));
    expect(count(utterance.pcm, 3)).toBe(ms(200));
  });

  it("force-cuts a monologue at 20 seconds and keeps listening", () => {
    const buffer = new UtteranceBuffer();
    const clock = { ms: 0 };
    feed(buffer, 0.5, 1, clock);
    buffer.startSpeech(ms(500));

    const cuts = feed(buffer, 45, 2, clock);

    expect(cuts).toHaveLength(2);
    expect(cuts[0]!.pcm.length).toBeGreaterThanOrEqual(ms(20_000));
    expect(cuts[0]!.pcm.length).toBeLessThan(ms(20_100));
    expect(buffer.speaking).toBe(true);

    const rest = buffer.flush();
    expect(rest).not.toBeNull();
    expect(rest!.pcm.length).toBeGreaterThan(ms(4000));
    // Cuts do not overlap.
    expect(cuts[1]!.startMs).toBeGreaterThanOrEqual(cuts[0]!.endMs - 1);
  });

  it("drops an utterance with under 0.4 s of speech", () => {
    const buffer = new UtteranceBuffer();
    const clock = { ms: 0 };
    feed(buffer, 1, 1, clock);
    feed(buffer, 0.3, 2, clock);
    feed(buffer, 1, 3, clock);
    buffer.startSpeech(ms(1250));

    expect(buffer.endSpeech(ms(1300 + 600))).toBeNull();
    expect(buffer.speaking).toBe(false);
  });

  it("keeps an utterance with just over 0.4 s of speech", () => {
    const buffer = new UtteranceBuffer();
    const clock = { ms: 0 };
    feed(buffer, 1, 1, clock);
    feed(buffer, 0.5, 2, clock);
    feed(buffer, 1, 3, clock);
    buffer.startSpeech(ms(1250));

    expect(buffer.endSpeech(ms(1500 + 600))).not.toBeNull();
  });

  it("ignores a second start, an end with nothing open, and an empty flush", () => {
    const buffer = new UtteranceBuffer();
    const clock = { ms: 0 };

    expect(buffer.endSpeech()).toBeNull();
    expect(buffer.flush()).toBeNull();

    feed(buffer, 3, 2, clock);
    buffer.startSpeech(ms(1000));
    buffer.startSpeech(ms(2000)); // does not move the start

    expect(buffer.flush()!.pcm.length).toBe(ms(3000) - (ms(1000) - ms(550)));
  });

  it("starts at the beginning of history when the speech began before it", () => {
    const buffer = new UtteranceBuffer({ retainMs: 500 });
    const clock = { ms: 0 };
    feed(buffer, 5, 1, clock);
    buffer.startSpeech(ms(1000));

    // History only reaches back about 500 ms, so the cut starts there.
    const length = buffer.flush()!.pcm.length;
    expect(length).toBeGreaterThan(ms(400));
    expect(length).toBeLessThanOrEqual(ms(700));
  });

  it("reports its position as the count of samples taken in", () => {
    const buffer = new UtteranceBuffer();
    feed(buffer, 1, 0, { ms: 0 });

    expect(buffer.position).toBe(RATE);
  });

  it("ends at the latest sample when the event carries no index", () => {
    const buffer = new UtteranceBuffer();
    const clock = { ms: 0 };
    feed(buffer, 3, 2, clock);
    buffer.startSpeech();
    feed(buffer, 2, 2, clock);

    expect(buffer.endSpeech()).not.toBeNull();
  });
});
