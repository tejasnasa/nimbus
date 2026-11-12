/**
 * @module agent/__tests__/speaker
 * @description The assistant's speaker against a fake output and a fake speech
 * provider: frames are 20 ms, sentence N+1 synthesizes while N plays, leading
 * silence is trimmed, interrupting clears the queue and aborts every request in
 * flight, states are reported, and failures degrade rather than throw.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EARCON_MS,
  FRAME_MS,
  Speaker,
  type AudioOutput,
} from "../output/speaker.js";
import type { TtsAudio } from "../tts/openaiCompatibleTts.js";

const RATE = 24_000;
const FRAME = (RATE * FRAME_MS) / 1000;

/** A level per sentence, so frames can be traced back to their sentence. */
const LEVELS: Record<string, number> = {
  "One.": 1000,
  "Two.": 2000,
  "Three.": 3000,
};

function fakeOutput(opts: { delayMs?: number; failAt?: number } = {}) {
  const frames: Array<{ samples: Int16Array; rate: number }> = [];
  const log: string[] = [];
  const output: AudioOutput & { clears: number } = {
    clears: 0,
    async captureFrame(samples, rate) {
      if (opts.failAt !== undefined && frames.length === opts.failAt) {
        throw new Error("output closed");
      }
      frames.push({ samples, rate });
      log.push(`frame:${samples[samples.length - 1] || samples[0]}`);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    },
    clearQueue() {
      output.clears += 1;
    },
    async waitForPlayout() {
      log.push("drained");
    },
  };
  return { output, frames, log };
}

/** Text deltas as an async stream. */
async function* stream(...deltas: string[]) {
  for (const delta of deltas) yield delta;
}

/** A provider that returns `samples` of each sentence's level. */
function fakeTts(
  log: string[],
  opts: {
    samples?: number;
    fail?: string;
    hang?: boolean;
    leadingSilence?: number;
  } = {},
) {
  const signals: AbortSignal[] = [];
  const synthesize = vi.fn(
    async (text: string, signal: AbortSignal): Promise<TtsAudio> => {
      log.push(`synth:${text}`);
      signals.push(signal);
      if (text === opts.fail) throw new Error("provider down");
      const level = LEVELS[text] ?? 500;
      const total = opts.samples ?? FRAME * 2;
      async function* chunks() {
        if (opts.leadingSilence) yield new Int16Array(opts.leadingSilence);
        yield new Int16Array(total).fill(level);
        if (opts.hang) {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          });
        }
      }
      return { sampleRate: RATE, chunks: chunks() };
    },
  );
  return { synthesize, signals };
}

describe("Speaker", () => {
  it("queues 20 ms frames, padding the last one", async () => {
    const { output, frames } = fakeOutput();
    const states: string[] = [];
    const { synthesize } = fakeTts([], { samples: 1000 });
    const speaker = new Speaker({
      output,
      synthesize,
      onState: (s) => states.push(s),
    });

    expect(await speaker.speak(stream("One."))).toBe("finished");

    expect(frames).toHaveLength(Math.ceil(1000 / FRAME));
    for (const frame of frames) {
      expect(frame.samples).toHaveLength(FRAME);
      expect(frame.rate).toBe(RATE);
    }
    const last = frames[frames.length - 1]!.samples;
    expect(last[1000 - 2 * FRAME - 1]).toBe(1000);
    expect(last[FRAME - 1]).toBe(0);
    expect(states).toEqual(["speaking", "listening"]);
    expect(speaker.busy).toBe(false);
  });

  it("trims a sentence's leading silence", async () => {
    const { output, frames } = fakeOutput();
    const { synthesize } = fakeTts([], {
      samples: FRAME,
      leadingSilence: RATE / 2,
    });
    await new Speaker({ output, synthesize, onState: () => {} }).speak(
      stream("One."),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]!.samples[0]).toBe(1000);
  });

  it("synthesizes the next sentence while the current one plays", async () => {
    const { output, log } = fakeOutput({ delayMs: 2 });
    const { synthesize } = fakeTts(log);
    const speaker = new Speaker({ output, synthesize, onState: () => {} });

    await speaker.speak(stream("One. Tw", "o. Three."));

    const at = (entry: string) => log.indexOf(entry);
    const lastOf = (entry: string) => log.lastIndexOf(entry);
    expect(at("synth:One.")).toBeLessThan(at("frame:1000"));
    // Two is requested before One has finished playing...
    expect(at("synth:Two.")).toBeLessThan(lastOf("frame:1000"));
    // ...and Three only once One is done: never more than two in flight.
    expect(at("synth:Three.")).toBeGreaterThan(lastOf("frame:1000"));
    expect(at("frame:2000")).toBeGreaterThan(lastOf("frame:1000"));
    expect(at("frame:3000")).toBeGreaterThan(lastOf("frame:2000"));
    expect(log[log.length - 1]).toBe("drained");
  });

  it("interrupts: clears the queue, aborts every request in flight, reports listening", async () => {
    const { output, frames } = fakeOutput({ delayMs: 1 });
    const states: string[] = [];
    const { synthesize, signals } = fakeTts([], { hang: true });
    const speaker = new Speaker({
      output,
      synthesize,
      onState: (s) => states.push(s),
    });

    const done = speaker.speak(stream("One. Two. Three."));
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    expect(speaker.speaking).toBe(true);
    speaker.interrupt();

    expect(await done).toBe("interrupted");
    expect(output.clears).toBeGreaterThan(0);
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(states).toEqual(["speaking", "listening"]);
    expect(speaker.speaking).toBe(false);
    speaker.interrupt();
  });

  it("stops when the caller aborts", async () => {
    const { output, frames } = fakeOutput({ delayMs: 1 });
    const { synthesize, signals } = fakeTts([], { hang: true });
    const controller = new AbortController();
    const speaker = new Speaker({ output, synthesize, onState: () => {} });
    const done = speaker.speak(stream("One. Two."), controller.signal);
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
    controller.abort();
    expect(await done).toBe("interrupted");
    expect(signals[0]!.aborted).toBe(true);
  });

  it("skips a sentence whose synthesis fails", async () => {
    const { output, log } = fakeOutput();
    const { synthesize } = fakeTts(log, { fail: "Two." });
    await new Speaker({ output, synthesize, onState: () => {} }).speak(
      stream("One. Two. Three."),
    );
    expect(log.some((e) => e === "frame:2000")).toBe(false);
    expect(log.filter((e) => e === "frame:3000").length).toBeGreaterThan(0);
  });

  it("ends quietly when the output breaks or the text stream fails", async () => {
    const broken = fakeOutput({ failAt: 1 });
    const states: string[] = [];
    const speaker = new Speaker({
      output: broken.output,
      synthesize: fakeTts([]).synthesize,
      onState: (s) => states.push(s),
    });
    expect(await speaker.speak(stream("One. Two."))).toBe("finished");
    expect(states).toEqual(["speaking", "listening"]);

    async function* failing() {
      yield "One. ";
      throw new Error("stream broke");
    }
    const ok = fakeOutput();
    const second = new Speaker({
      output: ok.output,
      synthesize: fakeTts([]).synthesize,
      onState: () => {},
    });
    expect(await second.speak(failing())).toBe("finished");
    expect(ok.frames.length).toBeGreaterThan(0);
  });

  it("says nothing for an empty answer", async () => {
    const { output, frames, log } = fakeOutput();
    const states: string[] = [];
    await new Speaker({
      output,
      synthesize: fakeTts(log).synthesize,
      onState: (s) => states.push(s),
    }).speak(stream("   "));
    expect(frames).toHaveLength(0);
    expect(states).toEqual([]);
    expect(log).not.toContain("drained");
  });

  it("interrupts the previous answer when a new one starts", async () => {
    const { output, frames } = fakeOutput({ delayMs: 1 });
    const { synthesize, signals } = fakeTts([], { hang: true });
    const speaker = new Speaker({ output, synthesize, onState: () => {} });
    const first = speaker.speak(stream("One."));
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
    const second = speaker.speak(stream("Two."));
    expect(await first).toBe("interrupted");
    expect(signals[0]!.aborted).toBe(true);
    speaker.interrupt();
    expect(await second).toBe("interrupted");
  });

  it("says a fixed sentence", async () => {
    const { output, log } = fakeOutput();
    await new Speaker({
      output,
      synthesize: fakeTts(log).synthesize,
      onState: () => {},
    }).say("One.");
    expect(log).toContain("synth:One.");
  });

  it("chimes for 150 ms, but not over an answer", async () => {
    const { output, frames } = fakeOutput();
    const speaker = new Speaker({
      output,
      synthesize: fakeTts([]).synthesize,
      onState: () => {},
    });
    await speaker.chime(RATE);
    expect(frames).toHaveLength(Math.ceil((RATE * EARCON_MS) / 1000 / FRAME));
    expect(frames.some((f) => f.samples.some((v) => v !== 0))).toBe(true);

    const busy = fakeOutput({ delayMs: 1 });
    const { synthesize } = fakeTts([], { hang: true });
    const talking = new Speaker({
      output: busy.output,
      synthesize,
      onState: () => {},
    });
    const done = talking.speak(stream("One."));
    await vi.waitFor(() => expect(busy.frames.length).toBeGreaterThan(0));
    const before = busy.frames.length;
    await talking.chime();
    talking.interrupt();
    await done;
    expect(busy.frames.length - before).toBeLessThan(3);

    const failing = fakeOutput({ failAt: 0 });
    await new Speaker({
      output: failing.output,
      synthesize,
      onState: () => {},
    }).chime();
  });
});
