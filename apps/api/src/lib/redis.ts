/**
 * @module api/lib/redis
 * @description Dual ioredis connections backing the Socket.IO Redis adapter
 * (`pubClient`/`subClient` in `src/index.ts`) plus the presence services.
 * A single connection cannot serve as both publisher and subscriber, hence
 * the pair. Requires REDIS_URL.
 *
 * @important `maxRetriesPerRequest: null` is required by Socket.IO's adapter;
 *            `enableReadyCheck: false` on the subscriber avoids BLOCKED-state
 *            ready-check stalls. TLS verification is disabled for managed
 *            Redis hosts with self-signed certs.
 */
import Redis from "ioredis";

const redisConfig = {
  tls: {
    rejectUnauthorized: false,
  },
  maxRetriesPerRequest: null,
};

/** Publisher connection: adapter broadcasts + presence writes. */
export const pubClient = new Redis(process.env.REDIS_URL!, redisConfig);
/** Subscriber connection: adapter fan-out. Must stay a dedicated connection. */
export const subClient = new Redis(process.env.REDIS_URL!, {
  ...redisConfig,
  enableReadyCheck: false,
});

pubClient.on("error", (err) => console.error("Redis pubClient error:", err));
subClient.on("error", (err) => console.error("Redis subClient error:", err));
