import { Server } from "socket.io";
import { auth } from "../lib/auth";
import { fromNodeHeaders } from "better-auth/node";

const applySocketAuth = (io: Server) => {
  io.use(async (socket, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(socket.handshake.headers),
      });

      if (!session) {
        return next(new Error("Unauthorized"));
      }

      socket.data.user = session.user;
      next();
    } catch (error) {
      next(new Error("Unauthorized"));
    }
  });
};

export default applySocketAuth;
