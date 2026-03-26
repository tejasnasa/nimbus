import { ClientToServerEvents, ServerToClientEvents } from "@nimbus/types";
import { io, Socket } from "socket.io-client";

const URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  `${URL}`,
  {
    withCredentials: true,
    autoConnect: false,
  },
);
