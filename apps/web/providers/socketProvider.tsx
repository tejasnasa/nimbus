"use client";

import { useEffect } from "react";
import { socket } from "../lib/socket";

export function SocketProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.on("connect", () => console.log("[socket] connected:", socket.id));
    socket.on("connect_error", (err) =>
      console.error("[socket] connection error:", err.message),
    );

    return () => {
      socket.disconnect();
    };
  }, []);

  return <>{children}</>;
}
