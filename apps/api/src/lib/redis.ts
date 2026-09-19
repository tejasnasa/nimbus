/**
 * @module api/lib/redis
 * @description Dual ioredis connections backing the Socket.IO Redis adapter
 * (`pubClient`/`subClient` in `src/index.ts`) plus the presence services.
 * A single connection cannot serve as both publisher and subscriber, hence
 * the pair.
 *
 * @important TLS is derived from the connection string, because the scheme
 *            alone is not trustworthy: this service is configured `redis://`
 *            against a managed host that only speaks TLS. So `rediss://` means
 *            TLS outright, and a `redis://` URL is decided by its host — a
 *            managed host (an FQDN) is reached with TLS, an internal one
 *            (loopback, a private range, or a bare service name like `redis`)
 *            in plaintext. Getting this backwards is not a loud failure in one
 *            direction: forcing TLS at a plaintext server never completes the
 *            handshake, ioredis emits no `error` event at all, and the client
 *            simply never becomes ready — so the API starts, serves HTTP, and
 *            quietly has no presence, no cross-replica broadcast, and no log
 *            line saying why. The connect watchdog below turns that silence
 *            into a message. `REDIS_TLS=true|false` overrides the derivation
 *            for any host it gets wrong.
 *
 * @important `maxRetriesPerRequest: null` is required by Socket.IO's adapter;
 *            `enableReadyCheck: false` on the subscriber avoids BLOCKED-state
 *            ready-check stalls.
 */
import Redis from "ioredis";
import { env } from "./env";

/** Options accepted by {@link createRedisClients}. */
export type RedisClientOptions = {
  /** Connection string; defaults to the validated `REDIS_URL`. */
  url?: string;
  /**
   * Whether to negotiate TLS. Overrides both `REDIS_TLS` and the derived
   * transport, which is what tests use to pin a plaintext container.
   */
  tls?: boolean;
};

/** How long a client may stay short of `ready` before the watchdog complains. */
const CONNECT_WATCHDOG_MS = 10_000;

/**
 * Host portion of a Redis URL, without credentials, port or path.
 *
 * Parsed by hand rather than with `new URL` because credentials routinely
 * contain characters that make the string fail to parse as a URL at all.
 */
const hostOf = (url: string) => {
  const withoutScheme = url.replace(/^rediss?:\/\//i, "");
  const afterCredentials = withoutScheme.split("@").pop() ?? "";
  return afterCredentials.split(/[/:?#]/)[0] ?? "";
};

/**
 * Whether a host is only reachable from inside the deployment.
 *
 * Managed Redis is always addressed by FQDN over TLS, so a bare service name
 * (`redis`), a loopback address, or a private range is the signal for
 * plaintext.
 */
const isInternalHost = (host: string) => {
  // An IPv6 literal is bracketed; in practice only ever loopback or link-local.
  if (!host || host.startsWith("[")) return true;
  if (!host.includes(".")) return true;

  return (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
};

/** `REDIS_TLS` override; any other value (including unset) means "derive it". */
const tlsOverrideFromEnv = (): boolean | undefined => {
  if (process.env.REDIS_TLS === "true") return true;
  if (process.env.REDIS_TLS === "false") return false;
  return undefined;
};

/**
 * Resolves the transport for a connection string.
 *
 * @param url - Redis connection string.
 * @param override - Explicit setting that wins over the derivation.
 * @returns `true` to negotiate TLS.
 */
const resolveTls = (url: string, override?: boolean) => {
  if (override !== undefined) return override;
  if (/^rediss:\/\//i.test(url)) return true;

  return !isInternalHost(hostOf(url));
};

/**
 * Logs when a client has still not reached `ready`.
 *
 * There is no `error` event to listen for in the stalled-handshake case, so
 * polling `status` is the only way to notice. The timer is unreferenced, so it
 * can never hold the process open on the success path.
 */
const watchForStall = (client: Redis, role: string) => {
  const timer = setTimeout(() => {
    if (client.status === "ready") return;

    console.error(
      `Redis ${role} not ready after ${CONNECT_WATCHDOG_MS}ms ` +
        `(status: "${client.status}"). The connection string is wrong or the ` +
        "server is unreachable. Most often the URL scheme disagrees with the " +
        "server's transport: a managed host that requires TLS must be reached " +
        'over "rediss://", not "redis://". A stalled TLS handshake emits no ' +
        "error event of its own, which is why this watchdog exists.",
    );
  }, CONNECT_WATCHDOG_MS);

  timer.unref();
  client.once("ready", () => clearTimeout(timer));
};

/**
 * Creates an independent publisher/subscriber pair from one URL.
 *
 * @param options - Optional URL and TLS overrides. Both default to the
 *                  connection string, so the normal call passes nothing.
 * @returns The `pubClient` and `subClient`, each with an error logger and a
 *          connect watchdog.
 */
export const createRedisClients = (options: RedisClientOptions = {}) => {
  const url = options.url ?? env.REDIS_URL;
  const useTls = resolveTls(url, options.tls ?? tlsOverrideFromEnv());

  const base = {
    maxRetriesPerRequest: null,
    // Managed hosts frequently present certificates a default trust store
    // rejects; verification stays relaxed to match how this has always
    // connected rather than tightening it as a side effect of this change.
    ...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
  };

  const pubClient = new Redis(url, base);
  const subClient = new Redis(url, { ...base, enableReadyCheck: false });

  pubClient.on("error", (err) => console.error("Redis pubClient error:", err));
  subClient.on("error", (err) => console.error("Redis subClient error:", err));

  watchForStall(pubClient, "pubClient");
  watchForStall(subClient, "subClient");

  return { pubClient, subClient };
};

/** Process-wide pair used by the running server and the presence services. */
export const { pubClient, subClient } = createRedisClients();
