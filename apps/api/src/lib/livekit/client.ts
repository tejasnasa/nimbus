/**
 * @module api/lib/livekit/client
 * @description Lazily constructed server-side clients for the media server.
 *
 * The REST clients speak HTTP(S), while the environment carries the WebSocket
 * URL the browser needs, so the scheme is translated here. Clients are built on
 * first use and cached, which keeps a process that never touches voice (and
 * every test that does not) free of any connection setup.
 */
import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";

let roomService: RoomServiceClient | null = null;
let agentDispatch: AgentDispatchClient | null = null;

/** Reads a LiveKit setting at call time, so a changed value takes effect. */
function setting(
  name: "LIVEKIT_URL" | "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET",
): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/**
 * The media server's WebSocket URL, as handed to browsers.
 *
 * @returns `LIVEKIT_URL` verbatim.
 */
export function livekitUrl(): string {
  return setting("LIVEKIT_URL");
}

/**
 * The media server's HTTP(S) origin, derived from the WebSocket URL.
 *
 * @returns The same host with `ws` mapped to `http` and `wss` to `https`.
 */
export function livekitHttpUrl(): string {
  return livekitUrl().replace(/^ws(s?):\/\//i, "http$1://");
}

/**
 * API key and secret, for signing tokens and verifying webhooks.
 *
 * @returns The configured pair. Never log it.
 */
export function livekitCredentials(): { apiKey: string; apiSecret: string } {
  return {
    apiKey: setting("LIVEKIT_API_KEY"),
    apiSecret: setting("LIVEKIT_API_SECRET"),
  };
}

/**
 * The room management client (list, remove participants, delete rooms).
 *
 * @returns A cached client for the configured server.
 */
export function getRoomServiceClient(): RoomServiceClient {
  if (!roomService) {
    const { apiKey, apiSecret } = livekitCredentials();
    roomService = new RoomServiceClient(livekitHttpUrl(), apiKey, apiSecret);
  }
  return roomService;
}

/**
 * The agent dispatch client, for explicitly dispatching a worker into a room.
 *
 * @returns A cached client for the configured server.
 */
export function getAgentDispatchClient(): AgentDispatchClient {
  if (!agentDispatch) {
    const { apiKey, apiSecret } = livekitCredentials();
    agentDispatch = new AgentDispatchClient(
      livekitHttpUrl(),
      apiKey,
      apiSecret,
    );
  }
  return agentDispatch;
}

/** Drops the cached clients. Tests use it after changing the environment. */
export function resetLivekitClients(): void {
  roomService = null;
  agentDispatch = null;
}
