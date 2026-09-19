/**
 * @module api/__tests__/smoke/socket-unauth
 * @description The Socket.IO handshake guard: a real client with no session is
 * rejected during the handshake and never reaches a `connection` handler.
 *
 * Uses a real server on an ephemeral port and a real `socket.io-client`, so the
 * handshake-auth middleware actually runs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectClient,
  startTestServer,
  waitForEvent,
  type TestServer,
} from "@testhelpers";

describe("api smoke: socket handshake", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("rejects a handshake carrying no session", async () => {
    const client = connectClient(server.url);

    try {
      const error = await waitForEvent<Error>(client, "connect_error");
      expect(error.message).toBe("Unauthorized");
    } finally {
      client.close();
    }
  });

  it("never emits `connect` for an unauthenticated client", async () => {
    const client = connectClient(server.url);
    let connected = false;
    client.on("connect", () => {
      connected = true;
    });

    try {
      await waitForEvent<Error>(client, "connect_error");
      expect(connected).toBe(false);
    } finally {
      client.close();
    }
  });
});
