/**
 * @module agent/__tests__/nimbusClientAnswer
 * @description The client's answer stream and notices: NDJSON read line by line
 * across arbitrary chunk boundaries, the headers it sends, and every way the
 * stream can fail ending in one `error` line (or nothing, when cancelled).
 */
import type { AnswerLine, RedeemResponse } from "@nimbus/types";
import { describe, expect, it, vi } from "vitest";
import { NimbusClient } from "../api/nimbusClient.js";

const SECRET = "agent-secret-agent-secret-agent-secret";

const redeemed = {
  sessionToken: "session-token-123",
  meetingId: "m1",
} as RedeemResponse;

const envelope = (body: unknown, status = 200) =>
  new Response(
    JSON.stringify({ success: status < 400, responseObject: body }),
    { status },
  );

/** A body that delivers `parts` as separate chunks. */
const ndjson = (...parts: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { headers: { "content-type": "application/x-ndjson" } },
  );

async function setup(
  answer: (init: RequestInit) => Response | Promise<Response>,
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/redeem")) return envelope(redeemed);
      if (String(url).endsWith("/answer")) return answer(init ?? {});
      return envelope({ stop: false });
    },
  );
  const client = new NimbusClient({
    baseUrl: "https://api.test",
    secret: SECRET,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  await client.redeem("ticket");
  return { client, calls };
}

async function read(stream: AsyncIterable<AnswerLine>): Promise<AnswerLine[]> {
  const out: AnswerLine[] = [];
  for await (const line of stream) out.push(line);
  return out;
}

const body = { seq: 4, replySeq: 5, speak: true };

describe("answer", () => {
  it("yields each line as it arrives, across chunk boundaries", async () => {
    const { client, calls } = await setup(() =>
      ndjson(
        '{"type":"delta","text":"Hel',
        'lo. "}\n{"type":"delta","text":"Bye."}\n\nnot json\n',
        '{"type":"done","segmentSeq":5,"channel":"voice"}\n',
      ),
    );
    const lines = await read(client.answer(body, new AbortController().signal));
    expect(lines).toEqual([
      { type: "delta", text: "Hello. " },
      { type: "delta", text: "Bye." },
      { type: "done", segmentSeq: 5, channel: "voice" },
    ]);
    const call = calls.find((c) => c.url.endsWith("/answer"))!;
    expect(call.url).toBe("https://api.test/internal/agent/answer");
    expect(JSON.parse(String(call.init.body))).toEqual(body);
    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(headers["x-meeting-session"]).toBe("session-token-123");
  });

  it("passes an error line through", async () => {
    const { client } = await setup(() =>
      ndjson('{"type":"error","reason":"refused"}\n'),
    );
    expect(
      await read(client.answer(body, new AbortController().signal)),
    ).toEqual([{ type: "error", reason: "refused" }]);
  });

  it("ends a stream that stops without a closing line with an error", async () => {
    const { client } = await setup(() =>
      ndjson('{"type":"delta","text":"Half"}\n'),
    );
    const lines = await read(client.answer(body, new AbortController().signal));
    expect(lines.at(-1)).toEqual({ type: "error", reason: "failed" });
  });

  it("turns a refused request into an error line, and a 401 into a stop", async () => {
    const onStop = vi.fn();
    const { client } = await setup(() => envelope(null, 401));
    client.onStop(onStop);
    expect(
      await read(client.answer(body, new AbortController().signal)),
    ).toEqual([{ type: "error", reason: "failed" }]);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("turns a lost connection into an error line", async () => {
    const { client } = await setup(() => {
      throw new TypeError("fetch failed");
    });
    expect(
      await read(client.answer(body, new AbortController().signal)),
    ).toEqual([{ type: "error", reason: "failed" }]);
  });

  it("ends silently when cancelled", async () => {
    const controller = new AbortController();
    const { client } = await setup(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(init.signal!.reason),
          );
        }),
    );
    const pending = read(client.answer(body, controller.signal));
    controller.abort();
    expect(await pending).toEqual([]);
  });

  it("ends silently when cancelled mid-stream", async () => {
    const controller = new AbortController();
    const { client } = await setup(
      (init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(
                new TextEncoder().encode('{"type":"delta","text":"Hi"}\n'),
              );
              init.signal!.addEventListener("abort", () =>
                c.error(init.signal!.reason),
              );
            },
          }),
        ),
    );
    const lines: AnswerLine[] = [];
    for await (const line of client.answer(body, controller.signal)) {
      lines.push(line);
      controller.abort();
    }
    expect(lines).toEqual([{ type: "delta", text: "Hi" }]);
  });
});

describe("postNotice", () => {
  it("posts the notice kind with the session header", async () => {
    const { client, calls } = await setup(() => ndjson(""));
    await client.postNotice("budget-warning");
    const call = calls.find((c) => c.url.endsWith("/notice"))!;
    expect(JSON.parse(String(call.init.body))).toEqual({
      kind: "budget-warning",
    });
    expect(
      (call.init.headers as Record<string, string>)["x-meeting-session"],
    ).toBe("session-token-123");
  });
});
