/**
 * @module agent/__tests__/participantListener
 * @description One listener per participant: two people talking over each other
 * come out as two separate utterances, each with its own speaker, and stopping a
 * listener mid-sentence still delivers what was said.
 *
 * Runs the real Silero model on the bundled speech fixtures.
 */
import { describe, expect, it, vi } from "vitest";
import { listenToFrames } from "../audio/participantListener.js";
import type { Utterance } from "../audio/utteranceBuffer.js";
import {
  concat,
  frameClock,
  paced,
  readFixture,
  silence,
  toFrames,
} from "./helpers/audio.js";
import { loadRealVad } from "./helpers/vad.js";

type Heard = { who: string; utterance: Utterance };

describe("listenToFrames", () => {
  it("keeps two overlapping speakers apart and names each correctly", async () => {
    const vad = await loadRealVad();
    const heard: Heard[] = [];
    const starts: string[] = [];

    const listen = (who: string, pcm: Int16Array) =>
      listenToFrames({
        frames: paced(toFrames(pcm)),
        vad,
        clock: frameClock(),
        handlers: {
          onSpeechStart: () => starts.push(who),
          onSpeechEnd: () => undefined,
          onUtterance: (utterance) => heard.push({ who, utterance }),
        },
      });

    // Riya speaks at once; Sam starts a second later, so they overlap for most
    // of their sentences.
    const riya = listen("riya", concat(readFixture("speech.wav"), silence(1.5)));
    const sam = listen(
      "sam",
      concat(silence(1), readFixture("speech2.wav"), silence(1.5)),
    );

    await vi.waitFor(() => expect(heard).toHaveLength(2), { timeout: 10_000 });
    await Promise.all([riya.stop(), sam.stop()]);

    expect(heard.map((h) => h.who).sort()).toEqual(["riya", "sam"]);
    expect(new Set(starts)).toEqual(new Set(["riya", "sam"]));
    const bySpeaker = Object.fromEntries(heard.map((h) => [h.who, h.utterance]));
    // Each utterance holds its own speaker's sentence, not a blend.
    expect(bySpeaker.riya!.pcm.length / 16_000).toBeGreaterThan(3);
    expect(bySpeaker.sam!.pcm.length / 16_000).toBeGreaterThan(3);
    expect(bySpeaker.riya!.pcm).not.toEqual(bySpeaker.sam!.pcm);
  });

  it("delivers a sentence cut off by the participant leaving", async () => {
    const vad = await loadRealVad();
    const heard: Utterance[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closed = vi.fn();

    async function* frames() {
      // Three seconds of the sentence, then the track stays open and silent.
      yield* paced(toFrames(readFixture("speech.wav").subarray(0, 16_000 * 3)));
      await held;
    }

    let started = false;
    const listener = listenToFrames({
      frames: frames(),
      closeSource: () => {
        closed();
        release();
      },
      vad,
      clock: frameClock(),
      handlers: {
        onSpeechStart: () => {
          started = true;
        },
        onSpeechEnd: () => undefined,
        onUtterance: (utterance) => heard.push(utterance),
      },
    });

    await vi.waitFor(() => expect(started).toBe(true), { timeout: 10_000 });
    await listener.stop();

    expect(closed).toHaveBeenCalledOnce();
    expect(heard).toHaveLength(1);
    expect(heard[0]!.pcm.length / 16_000).toBeGreaterThan(1.5);
  });

  it("can be stopped twice without a second delivery", async () => {
    const vad = await loadRealVad();
    const heard: Utterance[] = [];
    const listener = listenToFrames({
      frames: paced(toFrames(silence(0.5))),
      vad,
      clock: frameClock(),
      handlers: {
        onSpeechStart: () => undefined,
        onSpeechEnd: () => undefined,
        onUtterance: (utterance) => heard.push(utterance),
      },
    });

    await listener.stop();
    await listener.stop();

    expect(heard).toHaveLength(0);
  });

  it("accepts a shorter end-of-turn silence for one listener", async () => {
    const vad = await loadRealVad();
    const heard: Utterance[] = [];
    const listener = listenToFrames({
      frames: paced(toFrames(concat(readFixture("speech.wav"), silence(1)))),
      vad,
      clock: frameClock(),
      handlers: {
        onSpeechStart: () => undefined,
        onSpeechEnd: () => undefined,
        onUtterance: (utterance) => heard.push(utterance),
      },
    });
    listener.setMinSilence(400);
    await vi.waitFor(() => expect(heard).toHaveLength(1), { timeout: 10_000 });
    listener.setMinSilence(600);
    await listener.stop();
  });
});
