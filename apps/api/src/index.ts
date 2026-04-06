import "dotenv/config";
import express from "express";
import cors from "cors";
import { auth } from "./lib/auth";
import { toNodeHandler } from "better-auth/node";
import masterRouter from "./routers/master.router";
import { createServer } from "http";
import { Server } from "socket.io";
import applySocketAuth from "./middleware/socket.middleware";
import registerChatHandlers from "./socket/chat";
import { createAdapter } from "@socket.io/redis-adapter";
import { pubClient, subClient } from "./lib/redis";
import { registerCanvasHandlers } from "./socket/canvas";
import { registerDocumentHandlers } from "./socket/document";
import morgan from "morgan";

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
app.all("/api/auth/{*any}", toNodeHandler(auth));
app.use("/api", masterRouter);

app.get("/", (req, res) => {
  res.send("Hello World to u!");
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
});

io.adapter(createAdapter(pubClient, subClient));

applySocketAuth(io);

io.on("connection", (socket) => {
  registerChatHandlers(io, socket);
  registerDocumentHandlers(io, socket);
  registerCanvasHandlers(io, socket);
});

httpServer.listen(3001, () => {
  console.log("Server is running on port 3001");
});
