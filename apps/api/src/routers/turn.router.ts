import express from "express";
import { getTurnCredentials } from "../controllers/turn.controller";

const turnRouter = express.Router();

turnRouter.get("/credentials", async (req, res) => {
  const { id } = req.user!;
  const response = await getTurnCredentials(id);

  return res.status(response.statusCode).json(response);
});

export default turnRouter;
