import express from "express";
import { getWorkspaceMessages } from "../controllers/message.controller";

const messageRouter = express.Router();

messageRouter.get("/:wsid", async (req, res) => {
  const { wsid } = req.params;
  const { id } = req.body.token;

  const response = await getWorkspaceMessages(wsid, id);

  return res.status(response.statusCode).json(response);
});

export default messageRouter;
