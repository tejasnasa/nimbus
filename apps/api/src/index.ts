/**
 * @module api/index
 * @description Express + Socket.IO server bootstrap.
 *
 * Order: CORS (credentialed, FRONTEND_URL origin) → JSON body parser →
 * request logging → better-auth handler → REST routers → Socket.IO with the
 * Redis pub/sub adapter → handshake auth → per-socket handler registration
 * (chat, document, canvas, voice).
 *
 * @important Required configuration is validated at startup by `lib/env`, which
 *            fails the process naming any missing variable. See that module for
 *            the required/optional split.
 *
 * @important The Redis adapter is what allows multi-instance horizontal
 *            scaling — without it, rooms and broadcasts are process-local.
 */
import { createAdapter } from "@socket.io/redis-adapter";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import "dotenv/config";
// Validates required configuration before anything below is composed. Must stay
// after `dotenv/config`, which is what makes the file's values visible.
import "./lib/env";
import express from "express";
import { createServer } from "http";
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
// client never has to JSON-parse an HTML error page.
app.use("/api", apiNotFoundHandler);

app.get("/", (req, res) => {
  res.send("Hello World to u!");
});

// Last, so it catches anything the route stack above did not handle.
app.use(errorHandler);

const httpServer = createServer(app);

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

httpServer.listen(3001, () => {
  console.log("Server is running on port 3001");
});
