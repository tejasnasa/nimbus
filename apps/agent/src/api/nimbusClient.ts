/**
 * @module agent/api/nimbusClient
 * @description The agent's client for the Nimbus API's internal routes:
 * redeeming the dispatch ticket, posting transcript segments, reporting state
 * and usage, asking for an answer, posting notices, and saying goodbye.
 *
 * An answer arrives as `application/x-ndjson`: text deltas, then one `done` or
 * `error` line. It is read line by line as it streams, so speech can start on
 * the first sentence.
 *
 * Segments are batched (up to ten, or 300 ms, whichever comes first) and kept
 * in a local outbox until the API confirms them. A failed post is retried with
 * exponential backoff, which is safe because the API stores segments
 * idempotently by sequence number.
 *
 * @important The outbox is bounded at 500 segments. Past that the oldest are
 *            dropped with a warning: the call is still captioned live, only
 *            persistence of the dropped ones is lost, and an unbounded queue in
 *            a long outage would exhaust the agent's memory.
 *
 * @important Any response may carry `stop: true`, which means the budget or
 *            spend cap is gone or the meeting was ended elsewhere. It is
 *            surfaced through `onStop` exactly once, and a 401 on a session
 *            call is treated the same way, because the session no longer exists.
 *
 * @important The shared secret and the session token are sent only in request
 *            headers and never appear in a log line or an error message.
 */
import type {
  AgentNoticeKind,
  AnswerLine,
  AnswerRequest,
  EndedRequest,
  RedeemResponse,
  SegmentIn,
  SegmentsResponse,
  StateRequest,
  StopResponse,
  UsageIn,
} from "@nimbus/types";

/** Segments per post. */
export const BATCH_SIZE = 10;

/** How long a partial batch waits before it is sent, in milliseconds. */
export const BATCH_WINDOW_MS = 300;

/** Segments kept locally while the API is unreachable. */
export const OUTBOX_LIMIT = 500;

/** Attempts at one post before it is parked until the next trigger. */
export const MAX_ATTEMPTS = 6;

/** First and longest backoff between attempts, in milliseconds. */
export const BACKOFF_START_MS = 250;
export const BACKOFF_MAX_MS = 8000;

/** Per-request timeout, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Longest an answer stream may stay open, in milliseconds. */
export const ANSWER_TIMEOUT_MS = 30_000;

/** Raised when the API refuses to hand out a session. Says nothing about why. */
export class RedeemError extends Error {
  constructor() {
    super("The Nimbus API did not accept the meeting ticket");
    this.name = "RedeemError";
  }
}

/** What the client needs to reach the API. */
export type NimbusClientOptions = {
  baseUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
  /** Sleeps; replaced in tests so backoff costs no real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Reports a non-fatal problem. Messages never contain secrets. */
  warn?: (message: string) => void;
};

type Envelope<T> = { success: boolean; responseObject: T };

/** Result of one HTTP exchange. */
type Reply<T> =
  | { kind: "ok"; body: T }
  | { kind: "unauthorized" }
  | { kind: "rejected" }
  | { kind: "retry" };

/** Client for `/internal/agent/*`. */
export class NimbusClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly warn: (message: string) => void;

  private sessionToken: string | null = null;
  private outbox: SegmentIn[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private sending: Promise<void> | null = null;
  private stopHandler: (() => void) | null = null;
  private stopped = false;

  constructor(options: NimbusClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.secret = options.secret;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.warn = options.warn ?? (() => undefined);
  }

  /** Registers the function called when the API says to stop. */
  onStop(handler: () => void): void {
    this.stopHandler = handler;
  }

  private signalStop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopHandler?.();
  }

  private async exchange<T>(
    path: string,
    body: unknown,
    withSession: boolean,
  ): Promise<Reply<T>> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.secret}`,
      "content-type": "application/json",
    };
    if (withSession && this.sessionToken) {
      headers["x-meeting-session"] = this.sessionToken;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/internal/agent${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { kind: "retry" };
    }

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status >= 500 || res.status === 429) return { kind: "retry" };
    if (!res.ok) return { kind: "rejected" };
    try {
      const envelope = (await res.json()) as Envelope<T>;
      return { kind: "ok", body: envelope.responseObject };
    } catch {
      return { kind: "retry" };
    }
  }

  /**
   * Redeems the dispatch ticket for the session's configuration.
   *
   * @param ticket - The one-time value from the dispatch metadata.
   * @throws {RedeemError} Whatever the cause; the API says nothing about why.
   */
  async redeem(ticket: string): Promise<RedeemResponse> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const reply = await this.exchange<RedeemResponse>(
        "/redeem",
        { ticket },
        false,
      );
      if (reply.kind === "ok") {
        this.sessionToken = reply.body.sessionToken;
        return reply.body;
      }
      if (reply.kind !== "retry") break;
      await this.sleep(BACKOFF_START_MS * 2 ** attempt);
    }
    throw new RedeemError();
  }

  /** Queues a segment for posting. */
  queueSegment(segment: SegmentIn): void {
    this.outbox.push(segment);
    if (this.outbox.length > OUTBOX_LIMIT) {
      const dropped = this.outbox.length - OUTBOX_LIMIT;
      this.outbox.splice(0, dropped);
      this.warn(`Dropped ${dropped} unsent transcript segment(s): outbox is full`);
    }
    if (this.outbox.length >= BATCH_SIZE) {
      this.clearBatchTimer();
      this.kick();
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        this.kick();
      }, BATCH_WINDOW_MS);
    }
  }

  /** Number of segments not yet confirmed by the API. */
  get pendingSegments(): number {
    return this.outbox.length;
  }

  private clearBatchTimer(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = null;
  }

  /** Starts the sender if it is not already running. */
  private kick(): void {
    if (this.sending) return;
    this.sending = this.sendLoop().then((drained) => {
      this.sending = null;
      // A full batch queued while the last post was finishing needs its own
      // turn. After a parked loop it must not: the API is unreachable, and the
      // next queued segment or flush will try again.
      if (drained && this.outbox.length >= BATCH_SIZE && !this.stopped) {
        this.kick();
      }
    });
  }

  /** Sends until the outbox is empty. Returns false if it parked instead. */
  private async sendLoop(): Promise<boolean> {
    while (this.outbox.length > 0) {
      const batch = this.outbox.slice(0, BATCH_SIZE);
      const before = this.outbox.length;
      const sent = await this.postBatch(batch);
      // A reply that confirmed none of the batch would otherwise repeat forever.
      if (!sent || this.outbox.length >= before) return false;
    }
    return true;
  }

  /** Posts one batch with retries. Returns false if it should be parked. */
  private async postBatch(batch: SegmentIn[]): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const reply = await this.exchange<SegmentsResponse>(
        "/segments",
        { segments: batch },
        true,
      );
      if (reply.kind === "ok") {
        const accepted = new Set(reply.body.accepted);
        this.outbox = this.outbox.filter((s) => !accepted.has(s.seq));
        if (reply.body.stop) this.signalStop();
        return true;
      }
      if (reply.kind === "unauthorized") {
        this.signalStop();
        this.outbox = [];
        return false;
      }
      if (reply.kind === "rejected") {
        this.warn("The API refused a transcript batch; dropping it");
        const dropped = new Set(batch.map((s) => s.seq));
        this.outbox = this.outbox.filter((s) => !dropped.has(s.seq));
        return true;
      }
      await this.sleep(
        Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** attempt),
      );
    }
    this.warn("Could not reach the API; transcript segments are being held");
    return false;
  }

  /**
   * Sends everything in the outbox, waiting at most `timeoutMs`.
   *
   * @returns True if the outbox is empty afterwards.
   */
  async flush(timeoutMs: number): Promise<boolean> {
    this.clearBatchTimer();
    const work = (async () => {
      if (this.sending) await this.sending;
      if (this.outbox.length > 0 && !this.stopped) {
        this.sending = this.sendLoop().then(() => {
          this.sending = null;
        });
        await this.sending;
      }
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([work, timeout]);
    clearTimeout(timer);
    return this.outbox.length === 0;
  }

  /** Reports the agent's state and who it hears. Failures are swallowed. */
  async postState(state: StateRequest): Promise<void> {
    const reply = await this.exchange<StopResponse>("/state", state, true);
    this.handleStopReply(reply);
  }

  /**
   * Reports provider usage for the call log.
   *
   * @returns True when the API stored the entries, so the caller can keep them
   *          for another try when it did not.
   */
  async postUsage(entries: UsageIn[]): Promise<boolean> {
    if (entries.length === 0) return true;
    const reply = await this.exchange<StopResponse>("/usage", { entries }, true);
    this.handleStopReply(reply);
    return reply.kind === "ok";
  }

  /**
   * Asks the API to answer an addressed utterance, yielding its lines as they
   * arrive. Never throws: a failed request or a broken stream ends with an
   * `error` line, and a cancelled one simply ends.
   *
   * @param body - The addressed segment, the reserved reply number, and
   *               whether the reply will be spoken.
   * @param signal - Aborts the request and the stream.
   */
  async *answer(
    body: AnswerRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AnswerLine> {
    const failed: AnswerLine = { type: "error", reason: "failed" };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/internal/agent/answer`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.secret}`,
          "content-type": "application/json",
          ...(this.sessionToken
            ? { "x-meeting-session": this.sessionToken }
            : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(ANSWER_TIMEOUT_MS)]),
      });
    } catch {
      if (!signal.aborted) yield failed;
      return;
    }
    if (res.status === 401) this.signalStop();
    if (!res.ok || !res.body) {
      yield failed;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffered.indexOf("\n")) >= 0) {
          const raw = buffered.slice(0, newline).trim();
          buffered = buffered.slice(newline + 1);
          if (!raw) continue;
          let line: AnswerLine;
          try {
            line = JSON.parse(raw) as AnswerLine;
          } catch {
            continue;
          }
          yield line;
          if (line.type !== "delta") finished = true;
        }
      }
    } catch {
      // A broken or cancelled stream ends below.
    } finally {
      reader.releaseLock();
    }
    if (!finished && !signal.aborted) yield failed;
  }

  /**
   * Asks the API to post one of the fixed notices to the workspace chat.
   * Failures are swallowed.
   *
   * @param kind - Which notice.
   */
  async postNotice(kind: AgentNoticeKind): Promise<void> {
    const reply = await this.exchange<StopResponse>("/notice", { kind }, true);
    this.handleStopReply(reply);
  }

  /** Tells the API the agent is leaving. Failures are swallowed. */
  async postEnded(reason: EndedRequest["reason"]): Promise<void> {
    await this.exchange<Record<string, never>>("/ended", { reason }, true);
  }

  private handleStopReply(reply: Reply<StopResponse>): void {
    if (reply.kind === "unauthorized") this.signalStop();
    else if (reply.kind === "ok" && reply.body.stop) this.signalStop();
  }
}
