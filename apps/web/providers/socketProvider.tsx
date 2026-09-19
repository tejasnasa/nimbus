/**
 * @module web/providers/socketProvider
 * @description App-level socket lifecycle: connects the shared client on
 * mount, logs connect/errors, and disconnects + unsubscribes on unmount.
 * Mount once in the root layout so all workspace screens share one connection.
 */
"use client";

import { useEffect } from "react";
import { socket } from "../lib/socket";

/**
 * Provides the socket connection lifecycle (no context — consumers import
 * the `socket` singleton directly).
 */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  // Guard: skip re-connect when HMR remounts with a live socket; cleanup
  // disconnects so no ghost connections linger after unmount/navigation.
  useEffect(() => {
    if (!socket.connected) socket.connect();

    const onConnectError = (err: Error) =>
      console.error("[socket] connection error:", err.message);

    socket.on("connect_error", onConnectError);

    return () => {
      socket.off("connect_error", onConnectError);
      socket.disconnect();
    };
  }, []);

  return <>{children}</>;
}
