/**
 * @module api/__tests__/unit/redis
 * @description Contract of the Redis transport derivation.
 *
 * Which transport a connection uses is not a cosmetic setting: forcing TLS at a
 * plaintext server never completes the handshake and ioredis emits no `error`
 * event, so the API starts and every realtime feature is silently dead. The
 * suite therefore pins the resolved transport for each shape of URL.
 *
 * Clients are built but never commanded — `createRedisClients` opens both
 * connections on construction, so every case disconnects them again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedisClients } from "../../lib/redis";

/** Port 1 refuses immediately, so nothing is left retrying in the background. */
const UNREACHABLE = "://127.0.0.1:1";

/** Builds a pair, reads back whether TLS was configured, then disconnects. */
const tlsFor = (url: string, tls?: boolean) => {
  const { pubClient, subClient } = createRedisClients(
    tls === undefined ? { url } : { url, tls },
  );

  try {
    return {
      host: pubClient.options.host,
      pubTls: Boolean(pubClient.options.tls),
      subTls: Boolean(subClient.options.tls),
    };
  } finally {
    pubClient.disconnect();
    subClient.disconnect();
  }
};

describe("lib/redis transport", () => {
  afterEach(() => {
    delete process.env.REDIS_TLS;
    vi.restoreAllMocks();
  });

  it("separates the host from credentials and port", () => {
    const { host } = tlsFor("redis://default:p%40ss@cache.example.com:6379/0");

    expect(host).toBe("cache.example.com");
  });

  it("keeps the boundary when a password contains an @", () => {
    const { host } = tlsFor("redis://user:p@ss@cache.example.com:6379");

    expect(host).toBe("cache.example.com");
  });

  it("negotiates TLS for a managed host even over a redis:// URL", () => {
    // The deployment shape this derivation exists for: `redis://` against a host
    // that only speaks TLS, where trusting the scheme alone would break it.
    const { pubTls, subTls } = tlsFor("redis://default:pw@staging-longhorn.upstash.io:6379");

    expect(pubTls).toBe(true);
    expect(subTls).toBe(true);
  });

  it("negotiates TLS for an explicit rediss:// URL", () => {
    expect(tlsFor("rediss" + UNREACHABLE).pubTls).toBe(true);
  });

  it.each([
    ["localhost", "redis://localhost:6379"],
    ["an IPv4 loopback literal", "redis://127.0.0.1:6379"],
    ["a bracketed IPv6 literal", "redis://[::1]:6379"],
    ["a bare compose service name", "redis://redis:6379"],
    ["a private 10.x address", "redis://10.0.0.7:6379"],
    ["a private 192.168.x address", "redis://192.168.1.20:6379"],
    ["a private 172.16-31.x address", "redis://172.20.5.5:6379"],
    ["a link-local address", "redis://169.254.1.1:6379"],
  ])("stays plaintext for %s", (_label, url) => {
    expect(tlsFor(url).pubTls).toBe(false);
  });

  it("lets an explicit option override the derivation in both directions", () => {
    expect(tlsFor("redis://cache.example.com:6379", false).pubTls).toBe(false);
    expect(tlsFor("redis://localhost:6379", true).pubTls).toBe(true);
  });

  it("lets REDIS_TLS force either transport regardless of host", () => {
    process.env.REDIS_TLS = "false";
    expect(tlsFor("redis://cache.example.com:6379").pubTls).toBe(false);

    process.env.REDIS_TLS = "true";
    expect(tlsFor("redis://localhost:6379").pubTls).toBe(true);
  });

  it("ignores a REDIS_TLS value it does not understand", () => {
    process.env.REDIS_TLS = "maybe";

    // Falls back to the derivation rather than guessing a transport.
    expect(tlsFor("redis://localhost:6379").pubTls).toBe(false);
    expect(tlsFor("redis://cache.example.com:6379").pubTls).toBe(true);
  });
});
