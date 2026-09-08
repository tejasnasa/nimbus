/**
 * @module web/lib/socket
 * @description Typed Socket.IO client singleton for the browser.
 *
 * Fully typed both directions (`ServerToClientEvents` /
 * `ClientToServerEvents` from `@nimbus/types`), credentialed cookies
 * (`withCredentials`) for handshake auth, and `autoConnect: false` so the
 * `SocketProvider` controls exactly when the connection opens.
 */
import { ClientToServerEvents, ServerToClientEvents } from "@nimbus/types";
import { io, Socket } from "socket.io-client";

const URL = process.env.NEXT_PUBLIC_BACKEND_URL;

/** Shared client socket — connect/disconnect only via `SocketProvider`. */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  `${URL}`,
  {
    withCredentials: true,
    autoConnect: false,
  },
);
