/**
 * @module agent/__tests__/nimbusClient
 * @description The internal API client: redemption, the batching window, retries
 * with backoff, the bounded outbox, the stop signal, and the headers it sends.
 *
 * The API is a fake `fetch` the test scripts, and backoff sleeps are recorded
 * rather than waited out.
 */
import type { RedeemResponse, SegmentIn } from "@nimbus/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKOFF_MAX_MS,
  BACKOFF_START_MS,
  BATCH_SIZE,
  BATCH_WINDOW_MS,
  MAX_ATTEMPTS,
  NimbusClient,
  OUTBOX_LIMIT,
  RedeemError,
} from "../api/nimbusClient.js";

const SECRET = "agent-secret-agent-secret-agent-secret";

const segment = (seq: number): SegmentIn => ({
  seq,
  speakerUserId: "u1",
  speakerName: "Ada",
  text: `line ${seq}`,
  startMs: seq * 1000,
  endMs: seq * 1000 + 500,
});

const envelope = (body: unknown, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, responseObject: body }), {
    status,
    headers: { "content-type": "application/json" },
  });

const redeemed: RedeemResponse = {
  sessionToken: "session-token-123",
  meetingId: "m1",
  workspaceId: "w1",
  roomName: "nimbus-ws-w1",
  startedAt: new Date().toISOString(),
  members: [],
  voice: { baseUrl: "https://stt.test/v1", apiKey: "k", transcribeModel: "m" },
  budgetSeconds: null,
  assistantSpeaks: false,
  wakeNames: ["nimbus"],
};

type Call = { url: string; init: RequestInit; body: unknown };

function setup(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const warnings: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      init: init ?? {},
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call, calls.length);
  });
  const client = new NimbusClient({
    baseUrl: "https://api.test/",
    secret: SECRET,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    warn: (m) => warnings.push(m),
  });
  return { client, calls, sleeps, warnings };
}

const acceptAll = (call: Call) =>
  envelope({
    accepted: (call.body as { segments: SegmentIn[] }).segments.map((s) => s.seq),
    stop: false,
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("redeem", () => {
  it("posts the ticket with the bearer secret and keeps the session token for later calls", async () => {
    const { client, calls } = setup((call) =>
      call.url.endsWith("/redeem") ? envelope(redeemed) : acceptAll(call),
    );

    const result = await client.redeem("ticket-abc");

    expect(result.meetingId).toBe("m1");
    expect(calls[0]!.url).toBe("https://api.test/internal/agent/redeem");
    expect(calls[0]!.body).toEqual({ ticket: "ticket-abc" });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(headers["x-meeting-session"]).toBeUndefined();

    await client.postState({ state: "listening" });
    const later = calls[1]!.init.headers as Record<string, string>;
    expect(later["x-meeting-session"]).toBe("session-token-123");
    expect(later.authorization).toBe(`Bearer ${SECRET}`);
  });

  it("retries a flaky network, then succeeds", async () => {
    const { client, sleeps } = setup((_call, n) => {
      if (n < 3) throw new TypeError("fetch failed");
      return envelope(redeemed);
    });

    await expect(client.redeem("t")).resolves.toMatchObject({ meetingId: "m1" });
    expect(sleeps).toEqual([BACKOFF_START_MS, BACKOFF_START_MS * 2]);
  });

  it("fails with an error that says nothing about why, and does not retry a refusal", async () => {
    const { client, calls } = setup(() => envelope(null, 401));

    const error = await client.redeem("t").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RedeemError);
    expect(String((error as Error).message)).not.toContain(SECRET);
    expect(calls).toHaveLength(1);
  });

  it("gives up after three tries on a server that keeps failing", async () => {
    const { client, calls } = setup(() => new Response("", { status: 503 }));

    await expect(client.redeem("t")).rejects.toBeInstanceOf(RedeemError);
    expect(calls).toHaveLength(3);
  });
});

describe("segments", () => {
  it("sends a partial batch after the batching window", async () => {
    vi.useFakeTimers();
    const { client, calls } = setup(acceptAll);

    client.queueSegment(segment(1));
    client.queueSegment(segment(2));
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS - 10);
    expect(calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.test/internal/agent/segments");
    expect((calls[0]!.body as { segments: SegmentIn[] }).segments.map((s) => s.seq)).toEqual([1, 2]);
    expect(client.pendingSegments).toBe(0);
  });

  it("sends a full batch at once without waiting for the window", async () => {
    vi.useFakeTimers();
    const { client, calls } = setup(acceptAll);

    for (let i = 1; i <= BATCH_SIZE; i++) client.queueSegment(segment(i));
    await vi.advanceTimersByTimeAsync(1);

    expect(calls).toHaveLength(1);
    expect((calls[0]!.body as { segments: SegmentIn[] }).segments).toHaveLength(BATCH_SIZE);
  });

  it("splits more than a batch into several posts", async () => {
    vi.useFakeTimers();
    const { client, calls } = setup(acceptAll);

    for (let i = 1; i <= BATCH_SIZE + 3; i++) client.queueSegment(segment(i));
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 10);

    expect(calls.map((c) => (c.body as { segments: unknown[] }).segments.length)).toEqual([
      BATCH_SIZE,
      3,
    ]);
  });

  it("retries a 5xx with doubling backoff and then succeeds, keeping the segments meanwhile", async () => {
    const { client, calls, sleeps } = setup((call, n) =>
      n <= 3 ? new Response("", { status: 502 }) : acceptAll(call),
    );

    client.queueSegment(segment(1));
    expect(await client.flush(1000)).toBe(true);

    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([250, 500, 1000]);
    expect(client.pendingSegments).toBe(0);
  });

  it("caps the backoff at eight seconds and parks the batch after six attempts", async () => {
    const { client, calls, sleeps, warnings } = setup(
      () => new Response("", { status: 500 }),
    );

    client.queueSegment(segment(1));
    expect(await client.flush(1000)).toBe(false);

    expect(calls).toHaveLength(MAX_ATTEMPTS);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
    expect(sleeps).toEqual([250, 500, 1000, 2000, 4000, 8000]);
    expect(client.pendingSegments).toBe(1);
    expect(warnings.join(" ")).toContain("held");
  });

  it("retries after a lost connection", async () => {
    const { client, calls } = setup((call, n) => {
      if (n === 1) throw new TypeError("fetch failed");
      return acceptAll(call);
    });

    client.queueSegment(segment(1));
    await client.flush(1000);

    expect(calls).toHaveLength(2);
    expect(client.pendingSegments).toBe(0);
  });

  it("drops the oldest segments once the outbox is full, and says so", async () => {
    vi.useFakeTimers();
    const { client, warnings } = setup(() => new Response("", { status: 500 }));

    for (let i = 1; i <= OUTBOX_LIMIT + 20; i++) client.queueSegment(segment(i));

    expect(client.pendingSegments).toBe(OUTBOX_LIMIT);
    expect(warnings.some((w) => w.includes("Dropped"))).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
  });

  it("drops a batch the API refuses outright, rather than resending it forever", async () => {
    const { client, calls, warnings } = setup(() => envelope(null, 400));

    client.queueSegment(segment(1));
    await client.flush(1000);

    expect(calls).toHaveLength(1);
    expect(client.pendingSegments).toBe(0);
    expect(warnings.join(" ")).toContain("refused");
  });

  it("does not loop when the API accepts nothing", async () => {
    const { client, calls } = setup(() => envelope({ accepted: [], stop: false }));

    client.queueSegment(segment(1));
    await client.flush(1000);

    expect(calls).toHaveLength(1);
    expect(client.pendingSegments).toBe(1);
  });

  it("signals stop once when the API says stop, however many replies say so", async () => {
    const stop = vi.fn();
    const { client } = setup((call) =>
      envelope({
        accepted: (call.body as { segments: SegmentIn[] }).segments.map((s) => s.seq),
        stop: true,
      }),
    );
    client.onStop(stop);

    client.queueSegment(segment(1));
    await client.flush(1000);
    client.queueSegment(segment(2));
    await client.flush(1000);

    expect(stop).toHaveBeenCalledOnce();
  });

  it("treats a 401 on the session as a stop and discards the outbox", async () => {
    const stop = vi.fn();
    const { client } = setup(() => envelope(null, 401));
    client.onStop(stop);

    client.queueSegment(segment(1));
    await client.flush(1000);

    expect(stop).toHaveBeenCalledOnce();
    expect(client.pendingSegments).toBe(0);
  });

  it("flush returns at the timeout even if the API is slow", async () => {
    vi.useFakeTimers();
    const { client } = setup(() => new Promise<Response>(() => undefined));

    client.queueSegment(segment(1));
    const flushed = client.flush(500);
    await vi.advanceTimersByTimeAsync(600);

    await expect(flushed).resolves.toBe(false);
  });
});

describe("state, usage and goodbye", () => {
  it("posts state and honours a stop in the reply", async () => {
    const stop = vi.fn();
    const { client, calls } = setup(() => envelope({ stop: true }));
    client.onStop(stop);

    await client.postState({ state: "listening", speakingUserIds: ["u1"] });

    expect(calls[0]!.url).toBe("https://api.test/internal/agent/state");
    expect(calls[0]!.body).toEqual({ state: "listening", speakingUserIds: ["u1"] });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("reports whether usage was stored", async () => {
    const ok = setup(() => envelope({ stop: false }));
    await expect(
      ok.client.postUsage([
        { feature: "transcription", model: "m", audioSeconds: 2, latencyMs: 300, status: "OK" },
      ]),
    ).resolves.toBe(true);
    expect(ok.calls[0]!.url).toBe("https://api.test/internal/agent/usage");

    const failing = setup(() => new Response("", { status: 500 }));
    await expect(
      failing.client.postUsage([
        { feature: "transcription", model: "m", audioSeconds: 2, latencyMs: 300, status: "OK" },
      ]),
    ).resolves.toBe(false);

    const none = setup(() => envelope({ stop: false }));
    await expect(none.client.postUsage([])).resolves.toBe(true);
    expect(none.calls).toHaveLength(0);
  });

  it("says goodbye with the reason", async () => {
    const { client, calls } = setup(() => envelope({}));

    await client.postEnded("budget");

    expect(calls[0]!.url).toBe("https://api.test/internal/agent/ended");
    expect(calls[0]!.body).toEqual({ reason: "budget" });
  });

  it("treats an unreadable reply as a failure to retry, never a crash", async () => {
    const { client } = setup(() => new Response("<html>", { status: 200 }));

    await expect(client.postUsage([
      { feature: "transcription", model: "m", audioSeconds: 1, latencyMs: 1, status: "OK" },
    ])).resolves.toBe(false);
  });
});
