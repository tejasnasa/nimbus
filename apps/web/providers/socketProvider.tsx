"use client";

import { useEffect } from "react";
import { socket } from "../lib/socket";

export function SocketProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!socket.connected) socket.connect();

    const onConnect = () => console.log("[socket] connected:", socket.id);
    const onConnectError = (err: Error) =>
      console.error("[socket] connection error:", err.message);

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.disconnect();
    };
  }, []);

  return <>{children}</>;
}
