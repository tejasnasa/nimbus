import "dotenv/config";
import express from "express";
import cors from "cors";
import { auth } from "./lib/auth";
import { toNodeHandler } from "better-auth/node";
import masterRouter from "./routers/master.router";
import { createServer } from "http";
import { Server } from "socket.io";
import applySocketAuth from "./middleware/socket.middleware";

const app = express();
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(express.json());

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

applySocketAuth(io);

httpServer.listen(3001, () => {
  console.log("Server is running on port 3001");
});
