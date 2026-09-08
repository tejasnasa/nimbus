/**
 * @module api/middleware/socket
 * @description Socket.IO handshake authenticator. Resolves the better-auth
 * session from the handshake headers and stores the user on
 * `socket.data.user`, so all event handlers can trust it without re-checking.
 * Rejected handshakes receive an "Unauthorized" error and never reach
 * the `connection` handlers.
 */
import { Server } from "socket.io";
import { auth } from "../lib/auth";
import { fromNodeHeaders } from "better-auth/node";

/**
 * Registers the authentication interceptor on the Socket.IO server.
 *
 * Must be applied before `io.on("connection", …)` — middleware registered
 * here runs during the handshake phase.
 *
 * @param io - The Socket.IO server instance to guard.
 */
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
