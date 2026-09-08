/**
 * @module api/routers/message
 * @description Chat history endpoint (`GET /api/messages/:wsid` → latest 50).
 * Membership enforcement lives in the controller.
 */
import express from "express";
import { getWorkspaceMessages } from "../controllers/message.controller";

const messageRouter = express.Router();

messageRouter.get("/:wsid", async (req, res) => {
  const { wsid } = req.params;
  const { id } = req.user!;
  
  const response = await getWorkspaceMessages(wsid, id);

  return res.status(response.statusCode).json(response);
});

export default messageRouter;
