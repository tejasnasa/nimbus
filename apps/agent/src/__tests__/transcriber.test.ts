/**
 * @module agent/__tests__/transcriber
 * @description Sequence numbers, the three-wide queue, in-order release under
 * out-of-order answers, the retry, the rejected key, and the usage entries.
 *
 * The provider is a fake whose answers the test releases by hand.
 */
import type { SegmentIn, UsageIn } from "@nimbus/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SttError, type SttRequest, type SttResult } from "../stt/openaiCompatibleStt.js";
import { Transcriber, type TranscriptionJob } from "../stt/transcriber.js";

/** A speech-level clip of the given length. */
const clip = (seconds: number, level = 8000) =>
  new Int16Array(Math.round(seconds * 16_000)).fill(level);

const job = (name: string, startMs = 0, pcm = clip(1)): TranscriptionJob => ({
  userId: `${name.toLowerCase()}-id`,
  name,
  startMs,
  endMs: startMs + 1000,
  pcm,
});

/** A provider whose requests stay open until the test settles them. */
function manualProvider() {
  const calls: Array<{
    request: SttRequest;
    resolve: (result: SttResult) => void;
    reject: (error: unknown) => void;
  }> = [];
  const stt = (request: SttRequest) =>
    new Promise<SttResult>((resolve, reject) => {
      calls.push({ request, resolve, reject });
    });
  return { stt, calls };
}

function harness(overrides: Partial<ConstructorParameters<typeof Transcriber>[0]> = {}) {
  const segments: SegmentIn[] = [];
  const usage: UsageIn[] = [];
  const fatal = vi.fn();
  const provider = manualProvider();
  const transcriber = new Transcriber({
    baseUrl: "https://stt.test/v1",
    apiKey: "key",
    model: "fake-model",
    glossary: (text) => text,
    stt: provider.stt,
    onSegment: (s) => segments.push(s),
    onUsage: (u) => usage.push(u),
    onFatal: fatal,
    retryDelayMs: 1,
    ...overrides,
  });
  return { transcriber, segments, usage, fatal, provider };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Transcriber", () => {
  it("numbers utterances from 1 in the order they were submitted", async () => {
    const { transcriber, segments, provider } = harness();

    const seqs = [
      transcriber.submit(job("Ada")),
      transcriber.submit(job("Bo")),
      transcriber.submit(job("Cy")),
    ];
    expect(seqs).toEqual([1, 2, 3]);

    provider.calls.forEach((c, i) => c.resolve({ text: `line ${i}` }));
    await transcriber.flush(1000);

    expect(segments.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(segments[0]).toMatchObject({
      speakerUserId: "ada-id",
      speakerName: "Ada",
      text: "line 0",
      startMs: 0,
      endMs: 1000,
    });
  });

  it("runs at most three requests at once", async () => {
    const { transcriber, provider } = harness();

    for (let i = 0; i < 5; i++) transcriber.submit(job("Ada", i * 1000));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 20));
    expect(provider.calls).toHaveLength(3);

    provider.calls[0]!.resolve({ text: "one" });
    await vi.waitFor(() => expect(provider.calls).toHaveLength(4));
    provider.calls[1]!.resolve({ text: "two" });
    await vi.waitFor(() => expect(provider.calls).toHaveLength(5));
  });

  it("releases segments in sequence order when the answers arrive out of order", async () => {
    const { transcriber, segments, provider } = harness();
    transcriber.submit(job("Ada"));
    transcriber.submit(job("Bo"));
    transcriber.submit(job("Cy"));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(3));

    provider.calls[2]!.resolve({ text: "third" });
    provider.calls[1]!.resolve({ text: "second" });
    await new Promise((r) => setTimeout(r, 20));
    expect(segments).toHaveLength(0); // still waiting for the first

    provider.calls[0]!.resolve({ text: "first" });
    await transcriber.flush(1000);

    expect(segments.map((s) => s.text)).toEqual(["first", "second", "third"]);
  });

  it("stops waiting for an earlier utterance after five seconds", async () => {
    vi.useFakeTimers();
    const { transcriber, segments, provider } = harness();
    transcriber.submit(job("Ada"));
    transcriber.submit(job("Bo"));
    await vi.advanceTimersByTimeAsync(1);
    expect(provider.calls).toHaveLength(2);

    provider.calls[1]!.resolve({ text: "second" });
    await vi.advanceTimersByTimeAsync(4900);
    expect(segments).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);
    expect(segments.map((s) => s.text)).toEqual(["second"]);

    // The slow one finally answering is too late to be released.
    provider.calls[0]!.resolve({ text: "first" });
    await vi.advanceTimersByTimeAsync(10);
    expect(segments.map((s) => s.text)).toEqual(["second"]);
    transcriber.close();
  });

  it("retries once on a server error and reports both requests", async () => {
    const { transcriber, segments, usage, provider } = harness();
    transcriber.submit(job("Ada"));

    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    provider.calls[0]!.reject(new SttError("server", 502));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(2));
    provider.calls[1]!.resolve({ text: "second try" });
    await transcriber.flush(1000);

    expect(segments.map((s) => s.text)).toEqual(["second try"]);
    expect(usage.map((u) => u.status)).toEqual(["ERROR", "OK"]);
    expect(usage[0]!.errorReason).toBe("provider-error");
  });

  it("retries a timeout, then gives up after the second failure and moves on", async () => {
    const { transcriber, segments, usage, provider } = harness();
    transcriber.submit(job("Ada"));
    transcriber.submit(job("Bo"));

    await vi.waitFor(() => expect(provider.calls).toHaveLength(2));
    provider.calls[0]!.reject(new SttError("timeout"));
    provider.calls[1]!.resolve({ text: "bo says hi" });
    await vi.waitFor(() => expect(provider.calls).toHaveLength(3));
    provider.calls[2]!.reject(new SttError("timeout"));
    await transcriber.flush(1000);

    expect(segments.map((s) => s.text)).toEqual(["bo says hi"]);
    expect(usage.filter((u) => u.errorReason === "timeout")).toHaveLength(2);
  });

  it("does not retry a refused request", async () => {
    const { transcriber, provider, usage } = harness();
    transcriber.submit(job("Ada"));

    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    provider.calls[0]!.reject(new SttError("client", 400));
    await transcriber.flush(1000);

    expect(provider.calls).toHaveLength(1);
    expect(usage).toHaveLength(1);
  });

  it("treats an unclassified failure like a lost connection", async () => {
    const { transcriber, provider, usage } = harness();
    transcriber.submit(job("Ada"));

    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    provider.calls[0]!.reject(new Error("boom"));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(2));
    provider.calls[1]!.resolve({ text: "ok" });
    await transcriber.flush(1000);

    expect(usage.map((u) => u.status)).toEqual(["ERROR", "OK"]);
  });

  it("stops the session when the key is rejected, and sends nothing further", async () => {
    const { transcriber, segments, usage, fatal, provider } = harness({
      concurrency: 1,
    });
    transcriber.submit(job("Ada"));
    transcriber.submit(job("Bo"));

    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    provider.calls[0]!.reject(new SttError("auth", 401));
    await transcriber.flush(1000);

    expect(fatal).toHaveBeenCalledExactlyOnceWith("invalid-key");
    expect(provider.calls).toHaveLength(1);
    expect(segments).toHaveLength(0);
    expect(usage[0]).toMatchObject({ status: "ERROR", errorReason: "invalid-key" });

    // Anything submitted afterwards is skipped without a request.
    transcriber.submit(job("Cy"));
    await transcriber.flush(1000);
    expect(provider.calls).toHaveLength(1);
  });

  it("drops a hallucinated result but still counts its usage", async () => {
    const { transcriber, segments, usage, provider } = harness();
    transcriber.submit(job("Ada", 0, clip(1, 10))); // near silence
    transcriber.submit(job("Bo"));

    await vi.waitFor(() => expect(provider.calls).toHaveLength(2));
    provider.calls[0]!.resolve({ text: "Thank you for watching.", seconds: 1 });
    provider.calls[1]!.resolve({ text: "Thank you for watching.", seconds: 1 });
    await transcriber.flush(1000);

    expect(segments.map((s) => s.speakerName)).toEqual(["Bo"]); // loud one kept
    expect(usage).toHaveLength(2);
  });

  it("reports billed seconds when the provider gives them, the clip length when not", async () => {
    const { transcriber, usage, provider } = harness();
    transcriber.submit(job("Ada", 0, clip(2)));
    transcriber.submit(job("Bo", 0, clip(3)));

    await vi.waitFor(() => expect(provider.calls).toHaveLength(2));
    provider.calls[0]!.resolve({ text: "a", seconds: 2.5 });
    provider.calls[1]!.resolve({ text: "b" });
    await transcriber.flush(1000);

    expect(usage.map((u) => u.audioSeconds).sort()).toEqual([2.5, 3]);
    expect(usage[0]).toMatchObject({
      feature: "transcription",
      model: "fake-model",
      status: "OK",
    });
    expect(usage[0]!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("applies the glossary, the prompt and the language", async () => {
    const { transcriber, segments, provider } = harness({
      glossary: (t) => t.replace("nimbusbot", "NimbusBot"),
      prompt: "Nimbus, Ada",
      language: "en",
    });
    transcriber.submit(job("Ada"));

    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    const request = provider.calls[0]!.request;
    expect(request).toMatchObject({
      baseUrl: "https://stt.test/v1",
      apiKey: "key",
      model: "fake-model",
      prompt: "Nimbus, Ada",
      language: "en",
    });
    expect(request.wav.byteLength).toBe(44 + 16_000 * 2);
    provider.calls[0]!.resolve({ text: "  hello nimbusbot  ", language: "fr" });
    await transcriber.flush(1000);

    expect(segments[0]).toMatchObject({ text: "hello NimbusBot", language: "fr" });
  });

  it("gives up waiting when a flush times out", async () => {
    vi.useFakeTimers();
    const { transcriber, provider } = harness();
    transcriber.submit(job("Ada"));
    await vi.advanceTimersByTimeAsync(1);
    expect(provider.calls).toHaveLength(1);

    const flushed = transcriber.flush(5000);
    await vi.advanceTimersByTimeAsync(5001);

    await expect(flushed).resolves.toBe(false);
    transcriber.close();
  });

  it("reserves numbers for replies without holding back later captions", async () => {
    const asked: boolean[] = [];
    const { transcriber, segments, provider } = harness({
      onSegment: (s, a) => {
        segments.push(s);
        asked.push(a);
      },
    });
    expect(transcriber.submit({ ...job("Ada"), asked: true })).toBe(1);
    expect(transcriber.reserveSeq()).toBe(2);
    expect(transcriber.submit(job("Bo"))).toBe(3);

    provider.calls[1]!.resolve({ text: "second" });
    provider.calls[0]!.resolve({ text: "first" });
    await transcriber.flush(1000);

    expect(segments.map((s) => s.seq)).toEqual([1, 3]);
    expect(asked).toEqual([true, false]);
  });
});
