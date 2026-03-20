import { workspaceSchema } from "@nimbus/types";
import express from "express";
import validate from "../middleware/validate.middleware";
import {
  createWorkspace,
  deleteWorkspace,
  getMyWorkspaces,
  getWorkspaceBySlugId,
  joinWorkspace,
} from "../controllers/workspace.controller";

const workspaceRouter = express.Router();

workspaceRouter.post("/create", validate(workspaceSchema), async (req, res) => {
  const { id } = req.body.token;
  const { name } = req.body;

  const response = await createWorkspace(name, id);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.get("/", async (req, res) => {
  const { id } = req.body.token;

  const response = await getMyWorkspaces(id);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.post("/join", async (req, res) => {
  const { inviteCode } = req.body;
  const { id } = req.body.token;

  const response = await joinWorkspace(inviteCode, id);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.delete("/delete/:wsid", async (req, res) => {
  const { wsid } = req.params;
  const { id } = req.body.token;

  const response = await deleteWorkspace(wsid, id);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.get("/:slugId", async (req, res) => {
  const { slugId } = req.params;
  const { id } = req.body.token;

  const response = await getWorkspaceBySlugId(slugId, id);

  return res.status(response.statusCode).json(response);
});

export default workspaceRouter;
