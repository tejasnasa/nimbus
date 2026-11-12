/**
 * @module agent/__tests__/openaiCompatibleTts
 * @description The speech request: its shape, the sample rate read from the
 * response, streamed and buffered bodies, odd byte boundaries, the timeout,
 * error classes that never carry the key, and the usage entry per request.
 */
import type { UsageIn } from "@nimbus/types";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PCM_RATE,
  rateFromContentType,
  synthesize,
  TtsError,
} from "../tts/openaiCompatibleTts.js";

const KEY = "sk-speech-secret-key";

const base = {
  baseUrl: "https://speech.test/v1/",
  apiKey: KEY,
  model: "fish-audio/drama-3",
  input: "Hello there.",
};

/** Little-endian bytes of the given samples. */
const bytes = (...samples: number[]) =>
  new Uint8Array(new Int16Array(samples).buffer);

async function collect(chunks: AsyncIterable<Int16Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of chunks) out.push(...chunk);
  return out;
}

const streamOf = (...parts: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });

describe("synthesize", () => {
  it("posts the expected request and reads the rate from the content type", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(streamOf(bytes(1, 2, 3)), {
          headers: { "content-type": "audio/pcm;rate=44100;channels=1" },
        }),
    );
    const usage: UsageIn[] = [];
    let t = 0;
    const audio = await synthesize({
      ...base,
      voice: "nadine",
      fetchImpl,
      onUsage: (e) => usage.push(e),
      now: () => (t += 100),
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://speech.test/v1/audio/speech");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${KEY}`,
    );
    expect(JSON.parse(String(init.body))).toEqual({
      model: "fish-audio/drama-3",
      input: "Hello there.",
      response_format: "pcm",
      voice: "nadine",
    });
    expect(audio.sampleRate).toBe(44_100);
    expect(await collect(audio.chunks)).toEqual([1, 2, 3]);
    expect(usage).toEqual([
      {
        feature: "speech",
        model: "fish-audio/drama-3",
        characters: 12,
        latencyMs: 100,
        status: "OK",
      },
    ]);
  });

  it("leaves the default voice out of the request", async () => {
    const fetchImpl = vi.fn(async () => new Response(streamOf(bytes(0))));
    await synthesize({ ...base, voice: "default", fetchImpl });
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("voice");
  });

  it("joins samples split across chunk boundaries", async () => {
    const all = bytes(1000, -2000, 3000);
    const fetchImpl = vi.fn(
      async () =>
        new Response(streamOf(all.slice(0, 1), all.slice(1, 3), all.slice(3))),
    );
    const audio = await synthesize({ ...base, fetchImpl });
    expect(audio.sampleRate).toBe(DEFAULT_PCM_RATE);
    expect(await collect(audio.chunks)).toEqual([1000, -2000, 3000]);
  });

  it("reads a body that does not stream as one buffer", async () => {
    const response = {
      ok: true,
      status: 200,
      body: null,
      headers: new Headers({ "content-type": "audio/pcm;rate=24000" }),
      arrayBuffer: async () => bytes(7, 8).buffer,
    } as unknown as Response;
    const audio = await synthesize({
      ...base,
      fetchImpl: async () => response,
    });
    expect(await collect(audio.chunks)).toEqual([7, 8]);
  });

  it.each([
    [401, "auth", "invalid-key"],
    [403, "auth", "invalid-key"],
    [500, "server", "provider-error"],
    [429, "server", "provider-error"],
    [400, "client", "provider-error"],
  ] as const)(
    "classifies %i as %s, never echoing the key",
    async (status, kind, reason) => {
      const usage: UsageIn[] = [];
      const failure = await synthesize({
        ...base,
        fetchImpl: async () => new Response(`bad key ${KEY}`, { status }),
        onUsage: (e) => usage.push(e),
      }).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(TtsError);
      expect((failure as TtsError).kind).toBe(kind);
      expect((failure as TtsError).message).not.toContain(KEY);
      expect(usage[0]).toMatchObject({ status: "ERROR", errorReason: reason });
    },
  );

  it("times out", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () =>
            reject(init!.signal!.reason),
          );
        }),
    );
    const usage: UsageIn[] = [];
    const failure = await synthesize({
      ...base,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
      onUsage: (e) => usage.push(e),
    }).catch((e: unknown) => e);
    expect((failure as TtsError).kind).toBe("timeout");
    expect(usage[0]).toMatchObject({ status: "ERROR", errorReason: "timeout" });
  });

  it("reports a lost connection as a network failure", async () => {
    const failure = await synthesize({
      ...base,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    }).catch((e: unknown) => e);
    expect((failure as TtsError).kind).toBe("network");
  });

  it("stops a streaming body when aborted, still counting the request", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes(5, 6));
        controller.signal.addEventListener("abort", () =>
          c.error(new DOMException("x", "AbortError")),
        );
      },
    });
    const usage: UsageIn[] = [];
    const audio = await synthesize({
      ...base,
      signal: controller.signal,
      fetchImpl: async () => new Response(body),
      onUsage: (e) => usage.push(e),
    });
    const read: number[] = [];
    const failure = await (async () => {
      for await (const chunk of audio.chunks) {
        read.push(...chunk);
        controller.abort();
      }
    })().catch((e: unknown) => e);
    expect(read).toEqual([5, 6]);
    expect((failure as TtsError).kind).toBe("aborted");
    expect(usage).toHaveLength(1);
    expect(usage[0]!.status).toBe("OK");
  });

  it("reports a body that breaks off as an error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes(1));
        c.error(new TypeError("socket hang up"));
      },
    });
    const usage: UsageIn[] = [];
    const audio = await synthesize({
      ...base,
      fetchImpl: async () => new Response(body),
      onUsage: (e) => usage.push(e),
    });
    const failure = await collect(audio.chunks).catch((e: unknown) => e);
    expect((failure as TtsError).kind).toBe("network");
    expect(usage).toEqual([
      expect.objectContaining({
        status: "ERROR",
        errorReason: "provider-error",
      }),
    ]);
  });

  it("counts a request whose reader stopped early", async () => {
    const usage: UsageIn[] = [];
    const audio = await synthesize({
      ...base,
      fetchImpl: async () => new Response(streamOf(bytes(1), bytes(2))),
      onUsage: (e) => usage.push(e),
    });
    for await (const chunk of audio.chunks) {
      expect(chunk).toHaveLength(1);
      break;
    }
    expect(usage).toHaveLength(1);
  });
});

describe("rateFromContentType", () => {
  it.each([
    ["audio/pcm;rate=44100;channels=1", 44_100],
    ["audio/pcm; rate=24000", 24_000],
    ["audio/pcm", DEFAULT_PCM_RATE],
    [null, DEFAULT_PCM_RATE],
    ["audio/pcm;rate=12", DEFAULT_PCM_RATE],
  ])("reads %j as %i", (header, rate) => {
    expect(rateFromContentType(header)).toBe(rate);
  });
});
