/**
 * @module api/app
 * @description Composable factories for the HTTP surface — the Express app, the
 * Socket.IO server, and the HTTP server binding them. `src/index.ts` is a thin
 * bootstrap over these, so tests can build the identical wiring on an ephemeral
 * port instead of inheriting a listener started as an import side effect.
 *
 * Express stack order matters: CORS (credentialed, FRONTEND_URL origin) → JSON
 * body parser → request logging → better-auth handler → REST routers → the
 * `/api` 404 → the health string → the terminal error handler. The two
 * handlers at the end are what keep every response, failures included, in the
 * `ServerResponse` envelope.
 */
import { createAdapter } from "@socket.io/redis-adapter";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "http";
import morgan from "morgan";
import { Server } from "socket.io";
import { auth } from "./lib/auth";
import { pubClient, subClient } from "./lib/redis";
import {
  apiNotFoundHandler,
  errorHandler,
} from "./middleware/error.middleware";
import applySocketAuth from "./middleware/socket.middleware";
import masterRouter from "./routers/master.router";
import { registerCanvasHandlers } from "./socket/canvas";
import registerChatHandlers from "./socket/chat";
import { registerDocumentHandlers } from "./socket/document";
import { registerVoiceHandlers } from "./socket/voice";

/**
 * Builds the Express app.
 *
 * @returns The app with CORS, `express.json()`, request logging, better-auth
 *          mounted at `/api/auth/{*any}`, the authenticated `/api` routers, the
 *          `/` health string, and the two terminal handlers that make the
 *          envelope universal. Not listening — the caller starts the server.
 */
export const createApp = (): Express => {
  const app = express();

  app.use(
    cors({
      origin: process.env.FRONTEND_URL,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.use(express.json());
  app.use(morgan("dev"));
  // better-auth exposes its own routes (sign-in, session, etc.) — mounted before
  // the app routers so `/api/auth/*` never hits authCheck or validation.
  app.all("/api/auth/{*any}", toNodeHandler(auth));
  app.use("/api", masterRouter);

  // Unknown /api/* paths answer in the same envelope as every real endpoint, so a
  // client never has to JSON-parse an HTML error page. Must sit after the
  // better-auth mount above, or unknown auth paths are shadowed by a 404.
  app.use("/api", apiNotFoundHandler);

  app.get("/", (req, res) => {
    res.send("Hello World to u!");
  });

  // Last, so it catches anything the route stack above did not handle.
  app.use(errorHandler);

  return app;
};

/**
 * Attaches Socket.IO to an HTTP server.
 *
 * @param httpServer - The server to bind. Usually from {@link createHttpServer}.
 * @returns The configured `io` instance (Room/broadcast API for callers).
 */
export const createIoServer = (httpServer: HttpServer): Server => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL,
      credentials: true,
    },
  });

  // Attach the Redis adapter before any connections so broadcasts fan out
  // across all API replicas instead of staying process-local.
  io.adapter(createAdapter(pubClient, subClient));

  // Handshake auth runs before "connection" — downstream handlers can trust `socket.data.user`.
  applySocketAuth(io);

  /** Fan out each authenticated socket to the four domain handler registrars. */
  io.on("connection", (socket) => {
    registerChatHandlers(io, socket);
    registerDocumentHandlers(io, socket);
    registerCanvasHandlers(io, socket);
    registerVoiceHandlers(io, socket);
  });

  return io;
};

/**
 * Composes app + Socket.IO over a single HTTP server without listening.
 *
 * The caller owns the lifecycle: `httpServer.listen(0, …)` in tests,
 * `httpServer.listen(3001, …)` in `src/index.ts`, then `io.close()` to tear down.
 *
 * @returns The Express app, the HTTP server, and the Socket.IO server.
 */
export const createHttpServer = () => {
  const app = createApp();
  const httpServer = createServer(app);
  const io = createIoServer(httpServer);

  return { app, httpServer, io };
};
