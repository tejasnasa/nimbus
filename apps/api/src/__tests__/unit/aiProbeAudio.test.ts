/**
 * @module api/__tests__/unit/aiProbeAudio
 * @description The audio key probes: the WAV they upload, the request shape,
 * the status-to-refusal mapping, and how a credential's probes combine into
 * verified kinds and warnings. The network is a stub `fetch`; the text probe
 * goes through a mocked SDK.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS } from "@nimbus/types";
import {
  buildToneWav,
  probeCredential,
  probeSpeech,
  probeTranscription,
} from "../../lib/ai/probe";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: createMock };
  },
}));

const KEY = "sk-test-fake-key-DISTINCT12345678";
const openai = AI_PROVIDERS.openai;
const BASE = "https://audio.example.test/v1";

type Call = { url: string; init: RequestInit };

function stubFetch(
  respond: (url: string) => Response | Promise<Response> | Error,
) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const out = await respond(url);
    if (out instanceof Error) throw out;
    return out;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue({ output_text: "ok" });
});

describe("buildToneWav", () => {
  it("writes a valid mono 16-bit PCM header", () => {
    const wav = buildToneWav(1);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
  });

  it("holds real audio, not silence", () => {
    const wav = buildToneWav(0.1);
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) {
      peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    }
    expect(peak).toBeGreaterThan(1000);
  });
});

describe("probeTranscription", () => {
  it("posts multipart with the file and model, authorised by the key", async () => {
    const { fetchImpl, calls } = stubFetch(() => json({ text: "" }));
    const result = await probeTranscription(openai, BASE, KEY, "gpt-4o-mini-transcribe", {
      fetchImpl,
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/audio/transcriptions`);
    const init = calls[0]!.init;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${KEY}`,
    );
    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    const file = form.get("file") as File;
    expect(file.name).toBe("probe.wav");
    expect(file.type).toBe("audio/wav");
    expect(file.size).toBeGreaterThan(44);
  });

  it.each([
    [401, "incorrect-key"],
    [403, "incorrect-key"],
    [404, "model-not-found"],
    [429, "unknown-error"],
  ])("maps a %i answer to %s", async (status, reason) => {
    const { fetchImpl } = stubFetch(() => json({ error: "no" }, status));
    const result = await probeTranscription(openai, BASE, KEY, "m", { fetchImpl });
    expect(result).toMatchObject({ ok: false, reason });
  });

  it("refuses a 200 whose body has no text field", async () => {
    const { fetchImpl } = stubFetch(() => json({ nope: true }));
    const result = await probeTranscription(openai, BASE, KEY, "m", { fetchImpl });
    expect(result.ok).toBe(false);
  });

  it("refuses an unparseable 200", async () => {
    const { fetchImpl } = stubFetch(() => new Response("not json", { status: 200 }));
    const result = await probeTranscription(openai, BASE, KEY, "m", { fetchImpl });
    expect(result.ok).toBe(false);
  });

  it("reads a thrown request as unreachable, without echoing the error", async () => {
    const { fetchImpl } = stubFetch(
      () => new Error(`connect ECONNREFUSED while sending ${KEY}`),
    );
    const result = await probeTranscription(openai, BASE, KEY, "m", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("DISTINCT12345678");
  });
});

describe("probeSpeech", () => {
  it("posts the word, the voice and a pcm format, and accepts audio bytes", async () => {
    const { fetchImpl, calls } = stubFetch(
      () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
    );
    const result = await probeSpeech(openai, BASE, KEY, "gpt-4o-mini-tts", "alloy", {
      fetchImpl,
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0]!.url).toBe(`${BASE}/audio/speech`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      model: "gpt-4o-mini-tts",
      input: "ok",
      response_format: "pcm",
      voice: "alloy",
    });
  });

  it("omits the voice for a model that takes none", async () => {
    const { fetchImpl, calls } = stubFetch(
      () => new Response(new Uint8Array([1]), { status: 200 }),
    );
    await probeSpeech(AI_PROVIDERS.openrouter, BASE, KEY, "fish-audio/drama-3", "default", {
      fetchImpl,
    });
    expect(JSON.parse(calls[0]!.init.body as string)).not.toHaveProperty("voice");
  });

  it("refuses an empty body", async () => {
    const { fetchImpl } = stubFetch(() => new Response(new Uint8Array(), { status: 200 }));
    const result = await probeSpeech(openai, BASE, KEY, "m", "alloy", { fetchImpl });
    expect(result.ok).toBe(false);
  });

  it("maps an error status and a thrown request", async () => {
    const bad = stubFetch(() => json({}, 401));
    await expect(
      probeSpeech(openai, BASE, KEY, "m", "alloy", { fetchImpl: bad.fetchImpl }),
    ).resolves.toMatchObject({ reason: "incorrect-key" });

    const down = stubFetch(() => new Error("boom"));
    await expect(
      probeSpeech(openai, BASE, KEY, "m", "alloy", { fetchImpl: down.fetchImpl }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("probeCredential", () => {
  const audioOk = (url: string) =>
    url.endsWith("/audio/transcriptions")
      ? json({ text: "" })
      : new Response(new Uint8Array([1, 2]), { status: 200 });

  it("verifies every kind the provider has when all probes pass", async () => {
    const { fetchImpl } = stubFetch(audioOk);
    const result = await probeCredential(openai, KEY, { fetchImpl });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    if (!result.ok) return;
    expect([...result.verifiedKinds].sort()).toEqual(["speech", "text", "transcription"]);
  });

  it("saves with a warning when only a secondary kind fails", async () => {
    const { fetchImpl } = stubFetch((url) =>
      url.endsWith("/audio/speech") ? json({}, 403) : audioOk(url),
    );
    const result = await probeCredential(openai, KEY, { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.verifiedKinds].sort()).toEqual(["text", "transcription"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^Speech models could not be verified/);
    expect(JSON.stringify(result)).not.toContain("DISTINCT12345678");
  });

  it("refuses the key when the primary text probe fails", async () => {
    createMock.mockRejectedValue({ status: 401 });
    const { fetchImpl } = stubFetch(audioOk);
    const result = await probeCredential(openai, KEY, { fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "incorrect-key" });
  });

  it("verifies a text-only provider without any audio request", async () => {
    const { fetchImpl, calls } = stubFetch(audioOk);
    const result = await probeCredential(AI_PROVIDERS.groq, KEY, { fetchImpl });
    expect(result).toMatchObject({ ok: true, verifiedKinds: ["text"], warnings: [] });
    expect(calls).toHaveLength(0);
  });
});
