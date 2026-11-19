/**
 * @module api/controllers/health
 * @description Liveness probe for the deployed API: a single anonymous request
 * that answers whether Postgres and Redis are actually reachable.
 *
 * Exists so that an external monitor — and the production smoke suite — can tell
 * "the API is up but its dependencies are not" from "the API is down", which no
 * authenticated endpoint can express without a write.
 *
 * @important `Promise.allSettled` alone is NOT a timeout. Both clients are
 *            created with `maxRetriesPerRequest: null`, the mode where ioredis
 *            queues commands indefinitely while the connection is down, so
 *            `ping()` never settles during an outage. Every probe is therefore
 *            raced against a real rejecting deadline, and Redis is additionally
 *            short-circuited on `status` before a ping is attempted. Without
 *            this the endpoint hangs rather than reporting unhealthy, which is
 *            strictly worse than having no endpoint at all.
 *
 * @important Responses never carry a dependency's own error text: this route is
 *            anonymous and public, and driver messages can name hosts, ports
 *            and credentials. A failed probe is reported as one of three
 *            curated phrases ({@link PROBE_ERROR}).
 *
 * @important The media-server probe is cached for {@link LIVEKIT_PROBE_TTL_MS}
 *            (process-local), because every anonymous hit would otherwise make
 *            an authenticated call to LiveKit. Concurrent requests inside the
 *            window share one probe. The database and Redis probes are cheap
 *            and are never cached.
 *
 * @important The media server is probed and reported (`checks.livekit`) but
 *            never decides the status: voice is optional, and a LiveKit outage
 *            must not mark the API unhealthy and get it restarted for nothing.
 */
import { prisma } from "@nimbus/db";
import { ServerResponse } from "@nimbus/types";
import { getRoomServiceClient } from "../lib/livekit/client";
import { pubClient } from "../lib/redis";

/** How long each dependency probe may take before it is reported as down. */
export const PROBE_TIMEOUT_MS = 1500;

/** How long a media-server probe result is reused, in milliseconds. */
export const LIVEKIT_PROBE_TTL_MS = 10_000;

/** The only failure descriptions the response may carry. */
export const PROBE_ERROR = {
  timeout: "did not respond in time",
  notReady: "not ready",
  unavailable: "unavailable",
} as const;

/** Outcome of one dependency probe. */
export interface ProbeResult {
  /** Whether the dependency answered inside {@link PROBE_TIMEOUT_MS}. */
  ok: boolean;
  /** Why it did not, when `ok` is false. */
  error?: string;
}

/** The dependency surface the probe needs — narrow, so tests can pass fakes. */
export interface HealthClients {
  database: {
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<unknown>;
  };
  redis: {
    status: string;
    ping(): PromiseLike<string>;
  };
  /** The media server; a cheap authenticated call proves it answers. */
  livekit: {
    listRooms(): PromiseLike<unknown>;
  };
}

/** Per-dependency outcomes, keyed for the `checks` field of the payload. */
export interface HealthChecks {
  database: ProbeResult;
  redis: ProbeResult;
  /** Reported only; it never changes the overall status. */
  livekit: ProbeResult;
}

/** A probe's own failure, carrying only a curated description. */
class ProbeError extends Error {}

/**
 * Rejects if `work` has not settled within {@link PROBE_TIMEOUT_MS}.
 *
 * The timer is unreferenced so a fast success never holds the event loop open.
 */
const withDeadline = async <T>(
  work: PromiseLike<T>,
  label: string,
  timeoutMs: number,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ProbeError(`${label} ${PROBE_ERROR.timeout}`)),
      timeoutMs,
    );
    timer.unref?.();
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

/** Reduces a settled probe to a {@link ProbeResult} with a curated reason. */
const toProbeResult = (settled: PromiseSettledResult<unknown>): ProbeResult =>
  settled.status === "fulfilled"
    ? { ok: true }
    : {
        ok: false,
        error:
          settled.reason instanceof ProbeError
            ? settled.reason.message
            : PROBE_ERROR.unavailable,
      };

/**
 * Probes every dependency concurrently.
 *
 * Redis is checked against `status` first: a client that is reconnecting would
 * queue the ping rather than fail it, so the deadline is the only thing that
 * would ever end the wait — and reporting "not ready" immediately is both
 * faster and more informative.
 *
 * @param clients - The dependencies to probe. Injected so the healthy, failed
 *                  and timed-out branches are testable without a live stack.
 * @param timeoutMs - Per-probe deadline. Defaults to
 *                    {@link PROBE_TIMEOUT_MS}; tests pass something small so the
 *                    timeout branch does not cost a real second and a half.
 * @returns Each dependency's outcome.
 */
export const probeDependencies = async (
  clients: HealthClients,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<HealthChecks> => {
  const database = withDeadline(
    clients.database.$queryRaw`SELECT 1`,
    "database",
    timeoutMs,
  );

  const redis =
    clients.redis.status === "ready"
      ? withDeadline(clients.redis.ping(), "redis", timeoutMs)
      : Promise.reject(new ProbeError(`redis ${PROBE_ERROR.notReady}`));

  const livekit = withDeadline(
    clients.livekit.listRooms(),
    "livekit",
    timeoutMs,
  );

  const [dbSettled, redisSettled, livekitSettled] = await Promise.allSettled([
    database,
    redis,
    livekit,
  ]);

  return {
    database: toProbeResult(dbSettled),
    redis: toProbeResult(redisSettled),
    livekit: toProbeResult(livekitSettled),
  };
};

/**
 * The media server client for the probe. Unconfigured LiveKit settings become
 * a failed probe rather than an exception, so health still answers.
 */
const livekitProbeClient = (): HealthClients["livekit"] => {
  try {
    return getRoomServiceClient();
  } catch (error) {
    const reason = error instanceof Error ? error : new Error(String(error));
    return { listRooms: () => Promise.reject(reason) };
  }
};

let livekitCache: { at: number; probe: Promise<unknown> } | null = null;

/**
 * Wraps the media server client so repeated health requests share one probe
 * for {@link LIVEKIT_PROBE_TTL_MS}.
 *
 * @param now - The clock in milliseconds.
 */
const cachedLivekit = (now: number): HealthClients["livekit"] => ({
  listRooms: () => {
    if (!livekitCache || now - livekitCache.at >= LIVEKIT_PROBE_TTL_MS) {
      const probe = Promise.resolve(livekitProbeClient().listRooms());
      // Each caller awaits it under its own deadline; this only keeps a
      // rejection nobody is currently awaiting from surfacing as unhandled.
      probe.catch(() => undefined);
      livekitCache = { at: now, probe };
    }
    return livekitCache.probe;
  },
});

/** Forgets the cached media-server probe. Tests only. */
export const resetLivekitProbeCache = (): void => {
  livekitCache = null;
};

/**
 * Answers the health probe in the standard response envelope.
 *
 * @returns 200 when Postgres and Redis answered, 503 otherwise, whatever the
 *          media server did. The degraded
 *          branch is built with the constructor rather than
 *          `ServerResponse.serviceUnavailable()` because that factory hardcodes
 *          its payload to `null` and cannot carry the per-dependency detail that
 *          makes this endpoint worth calling.
 */
export const getHealth = async () => {
  const checks = await probeDependencies({
    database: prisma,
    redis: pubClient,
    livekit: cachedLivekit(Date.now()),
  });

  const payload = {
    status: checks.database.ok && checks.redis.ok ? "ok" : "degraded",
    checks,
  };

  if (payload.status === "ok") {
    return ServerResponse.ok(payload, "Healthy");
  }

  return new ServerResponse(false, "Dependency check failed", payload, 503);
};
