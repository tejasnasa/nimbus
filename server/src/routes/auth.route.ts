import express, { Request, Response } from "express";
import { login } from "../controllers/auth.controller";

const authRouter = express.Router();

authRouter.post("/login", (req: Request, res: Response) => {
  const data = login();
});

export default authRouter;
