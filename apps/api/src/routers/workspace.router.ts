import { workspaceSchema } from "@nimbus/types";
import express from "express";
import validate from "../middleware/validate.middleware";
import { createWorkspace } from "../controllers/workspace.controller";

const workspaceRouter = express.Router();

workspaceRouter.post("/create", validate(workspaceSchema), async (req, res) => {
  const { id } = req.body.token;
  const { name } = req.body;

  const response = await createWorkspace(name, id);

  return res.status(response.statusCode).json(response);
});

export default workspaceRouter;
