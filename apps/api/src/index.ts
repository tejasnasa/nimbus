import "dotenv/config";
import express from "express";
import cors from "cors";
import { auth } from "./utils/auth";
import { toNodeHandler } from "better-auth/node";
import masterRouter from "./routers/master.router";

const app = express();
app.use(
  cors({
    origin: "http://localhost:3000",
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

app.listen(3001, () => {
  console.log("Server is running on port 3001");
});
