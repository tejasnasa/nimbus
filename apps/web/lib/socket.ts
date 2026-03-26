import { io, Socket } from "socket.io-client";

const URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export const socket: Socket = io(`${URL}`, {
  withCredentials: true,
  autoConnect: false,
});
