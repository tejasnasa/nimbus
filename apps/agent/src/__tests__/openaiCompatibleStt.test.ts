/**
 * @module agent/__tests__/openaiCompatibleStt
 * @description The transcription request against a real local HTTP server: the
 * multipart body it sends, the timeout, and the classification of every failure
 * without the key ever appearing in an error.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseWav } from "./helpers/audio.js";
import { encodeWav } from "../audio/wav.js";
import { SttError, transcribe } from "../stt/openaiCompatibleStt.js";

const KEY = "sk-super-secret-key-that-must-never-leak";

type Seen = {
  method?: string;
  url?: string;
  authorization?: string;
  contentType?: string;
  form?: FormData;
};

let server: Server;
let baseUrl: string;
let seen: Seen = {};
let respond: (res: import("node:http").ServerResponse) => void = () => undefined;

beforeAll(async () => {
  server = createServer(async (req: IncomingMessage, res) => {
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req as never,
      duplex: "half",
    } as RequestInit);
    seen = {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      contentType: req.headers["content-type"],
      form: await request.formData(),
    };
    respond(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const wav = encodeWav(Int16Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 16_000);

const json = (status: number, body: unknown) => (res: import("node:http").ServerResponse) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

describe("transcribe", () => {
  it("sends a multipart upload with the key in the Authorization header only", async () => {
    respond = json(200, { text: "hello there", usage: { seconds: 2 } });

    const result = await transcribe({
      baseUrl,
      apiKey: KEY,
      model: "openai/gpt-transcribe",
      wav,
      language: "en",
      prompt: "Nimbus, Priya",
    });

    expect(result).toEqual({ text: "hello there", seconds: 2, language: undefined });
    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("/v1/audio/transcriptions");
    expect(seen.authorization).toBe(`Bearer ${KEY}`);
    expect(seen.contentType).toMatch(/^multipart\/form-data; boundary=/);

    const form = seen.form!;
    expect(form.get("model")).toBe("openai/gpt-transcribe");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("language")).toBe("en");
    expect(form.get("prompt")).toBe("Nimbus, Priya");
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.wav");
    expect(file.type).toBe("audio/wav");
    const sent = parseWav(new Uint8Array(await file.arrayBuffer()));
    expect([...sent.pcm]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // The key is not in the body either.
    expect(JSON.stringify([...form.keys()])).not.toContain(KEY);
  });

  it("omits language and prompt when none are given, and tolerates a missing duration", async () => {
    respond = json(200, { text: "token billed", language: "en" });

    const result = await transcribe({ baseUrl: `${baseUrl}/`, apiKey: KEY, model: "m", wav });

    expect(result.seconds).toBeUndefined();
    expect(result.language).toBe("en");
    expect(seen.form!.has("language")).toBe(false);
    expect(seen.form!.has("prompt")).toBe(false);
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "server"],
    [500, "server"],
    [503, "server"],
    [400, "client"],
    [422, "client"],
  ])("classifies a %i as %s", async (status, kind) => {
    respond = json(status, { error: { message: `echo of ${KEY}` } });

    const error = await transcribe({ baseUrl, apiKey: KEY, model: "m", wav }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(SttError);
    expect((error as SttError).kind).toBe(kind);
    expect((error as SttError).status).toBe(status);
  });

  it("never puts the key, or the provider's text, in an error", async () => {
    respond = json(401, { error: { message: `bad key ${KEY}` } });

    const error = (await transcribe({ baseUrl, apiKey: KEY, model: "m", wav }).catch(
      (e: unknown) => e,
    )) as SttError;

    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain("bad key");
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(String(error.stack)).not.toContain(KEY);
  });

  it("marks only server, timeout and network failures as worth repeating", () => {
    expect(new SttError("server", 500).retryable).toBe(true);
    expect(new SttError("timeout").retryable).toBe(true);
    expect(new SttError("network").retryable).toBe(true);
    expect(new SttError("auth", 401).retryable).toBe(false);
    expect(new SttError("client", 400).retryable).toBe(false);
  });

  it("times out when the provider does not answer", async () => {
    respond = () => undefined; // never answers

    const error = (await transcribe({
      baseUrl,
      apiKey: KEY,
      model: "m",
      wav,
      timeoutMs: 100,
    }).catch((e: unknown) => e)) as SttError;

    expect(error).toBeInstanceOf(SttError);
    expect(error.kind).toBe("timeout");
  });

  it("reports a refused connection as a network failure", async () => {
    const error = (await transcribe({
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: KEY,
      model: "m",
      wav,
    }).catch((e: unknown) => e)) as SttError;

    expect(error.kind).toBe("network");
    expect(error.message).not.toContain(KEY);
  });

  it("rejects a 200 whose body is not the expected shape", async () => {
    respond = json(200, { nope: true });
    const notShaped = (await transcribe({ baseUrl, apiKey: KEY, model: "m", wav }).catch(
      (e: unknown) => e,
    )) as SttError;
    expect(notShaped.kind).toBe("client");

    respond = (res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("not json");
    };
    const notJson = (await transcribe({ baseUrl, apiKey: KEY, model: "m", wav }).catch(
      (e: unknown) => e,
    )) as SttError;
    expect(notJson.kind).toBe("client");
  });
});
