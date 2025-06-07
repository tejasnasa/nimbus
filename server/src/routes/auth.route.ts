import express, { Request, Response } from "express";
import { signup } from "../controllers/auth.controller";

const authRouter = express.Router();

authRouter.post("/signup", async (req: Request, res: Response) => {
  const { email, username, fullname, password } = req.body;
  const response = await signup(email, username, fullname, password);

  if (!response.success) {
    res.status(response.statusCode).json(response);
  }

  res
    .status(response.statusCode)
    .cookie("session", response.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    })
    .json(response.responseObject);
});

export default authRouter;
