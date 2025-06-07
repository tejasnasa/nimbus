import express from "express";
import "dotenv/config";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import authRouter from "./routes/auth.route";
import { connectDB } from "./lib/db";

const app = express();

app.use(express.json());
app.use(morgan("dev"));
app.use(cookieParser());

app.use("/api/v1/auth", authRouter);

const port = process.env.PORT;

app.listen(port, () => {
  connectDB();
  console.log(`Server running on port ${port}`);
});
