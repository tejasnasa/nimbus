/**
 * @module agent/__tests__/vad.fixture
 * @description The real Silero model on bundled audio: a spoken sentence is one
 * utterance, and silence and keyboard noise are none.
 *
 * Nothing is mocked here. This is the check that the detector settings and the
 * utterance buffer still agree after either changes.
 */
import { describe, expect, it } from "vitest";
import { listenToFrames } from "../audio/participantListener.js";
import type { Utterance } from "../audio/utteranceBuffer.js";
import { concat, frameClock, paced, readFixture, silence, toFrames } from "./helpers/audio.js";
import { loadRealVad } from "./helpers/vad.js";

/** Plays a clip through a real listener and returns what it produced. */
async function listenTo(pcm: Int16Array) {
  const vad = await loadRealVad();
  const utterances: Utterance[] = [];
  const listener = listenToFrames({
    frames: paced(toFrames(concat(pcm, silence(1.5)))),
    vad,
    clock: frameClock(),
    handlers: {
      onSpeechStart: () => undefined,
      onSpeechEnd: () => undefined,
      onUtterance: (u) => utterances.push(u),
    },
  });
  // The detector runs behind the frames; give it time to report the end.
  await new Promise((r) => setTimeout(r, 1500));
  await listener.stop();
  return utterances;
}

describe("voice activity on fixture audio", () => {
  it("turns a spoken sentence into one utterance", async () => {
    const utterances = await listenTo(readFixture("speech.wav"));

    expect(utterances).toHaveLength(1);
    const [only] = utterances;
    expect(only!.pcm.length / 16_000).toBeGreaterThan(3);
    expect(only!.pcm.length / 16_000).toBeLessThan(6.5);
  });

  it("produces nothing for silence", async () => {
    expect(await listenTo(readFixture("silence.wav"))).toHaveLength(0);
  });

  it("produces nothing for keyboard noise", async () => {
    expect(await listenTo(readFixture("keyboard.wav"))).toHaveLength(0);
  });
});
