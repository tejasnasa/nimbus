/**
 * @module testhelpers/socketHarness
 * @description Real Socket.IO server + real client harness.
 *
 * The server is built by the same factory the app uses (`createHttpServer`) and
 * bound to an ephemeral port (`listen(0)`), so the Redis adapter, rooms, and the
 * handshake-auth middleware all execute for real. Clients are genuine
 * `socket.io-client` instances — mocked sockets would fake the exact transport
 * and middleware semantics under test.
 */
import type { AddressInfo } from "node:net";
import {
  io as createSocketClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import { createHttpServer } from "../src/app";

/** A running test server and its teardown handle. */
export type TestServer = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

/**
 * Boots the API on an ephemeral port.
 *
 * @returns The server's base URL, its port, and `close()` to release both the
 *          Socket.IO server and the HTTP server.
 */
export const startTestServer = async (): Promise<TestServer> => {
  const { httpServer, io } = createHttpServer();

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: async () => {
      await io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
};

/**
 * Opens a real client socket. Auto-reconnection is disabled so a failed
 * handshake surfaces as a single deterministic `connect_error`.
 *
 * @param url - Base URL from {@link startTestServer}.
 * @param headers - Optional handshake headers (e.g. a session cookie).
 */
export const connectClient = (
  url: string,
  headers: Record<string, string> = {},
): ClientSocket =>
  createSocketClient(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    extraHeaders: headers,
  });

/**
 * Resolves with the first payload for `event`, or rejects on timeout.
 *
 * Tests should assert on events the *other* client receives, never on
 * sender-side side effects — polling is the main source of two-client flake.
 *
 * @param socket - The client to listen on.
 * @param event - Event name to await.
 * @param timeoutMs - How long to wait before rejecting (default 5s).
 */
export const waitForEvent = <T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 5_000,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${event}"`)),
      timeoutMs,
    );

    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
