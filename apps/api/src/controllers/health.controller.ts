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
 */
import { prisma } from "@nimbus/db";
import { ServerResponse } from "@nimbus/types";
import { pubClient } from "../lib/redis";

/** How long each dependency probe may take before it is reported as down. */
export const PROBE_TIMEOUT_MS = 1500;

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
}

/** Per-dependency outcomes, keyed for the `checks` field of the payload. */
export interface HealthChecks {
  database: ProbeResult;
  redis: ProbeResult;
}

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
      () => reject(new Error(`${label} did not respond in ${timeoutMs}ms`)),
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

/** Reduces a settled probe to a {@link ProbeResult}, keeping the reason. */
const toProbeResult = (settled: PromiseSettledResult<unknown>): ProbeResult =>
  settled.status === "fulfilled"
    ? { ok: true }
    : {
        ok: false,
        error:
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason),
      };

/**
 * Probes both dependencies concurrently.
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
      : Promise.reject(
          new Error(`redis not ready (status: "${clients.redis.status}")`),
        );

  const [dbSettled, redisSettled] = await Promise.allSettled([database, redis]);

  return {
    database: toProbeResult(dbSettled),
    redis: toProbeResult(redisSettled),
  };
};

/**
 * Answers the health probe in the standard response envelope.
 *
 * @returns 200 when both dependencies answered, 503 otherwise. The degraded
 *          branch is built with the constructor rather than
 *          `ServerResponse.serviceUnavailable()` because that factory hardcodes
 *          its payload to `null` and cannot carry the per-dependency detail that
 *          makes this endpoint worth calling.
 */
export const getHealth = async () => {
  const checks = await probeDependencies({
    database: prisma,
    redis: pubClient,
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
