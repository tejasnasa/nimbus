import { workspaceSchema } from "@nimbus/types";
import express from "express";
import validate from "../middleware/validate.middleware";
import {
  createWorkspace,
  deleteWorkspace,
  getMyWorkspaces,
  getWorkspaceBySlugId,
  joinWorkspace,
  regenerateInviteCode,
  removeMember,
  updateMemberRole,
  updateWorkspace,
} from "../controllers/workspace.controller";

const workspaceRouter = express.Router();

workspaceRouter.post("/create", validate(workspaceSchema), async (req, res) => {
  const { id } = req.user!;
  const { name, description } = req.body;

  const response = await createWorkspace(name, description, id);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.get("/", async (req, res) => {
  const { id } = req.user!;

  const response = await getMyWorkspaces(id);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.post("/join", async (req, res) => {
  const { inviteCode } = req.body;
  const { id } = req.user!;

  const response = await joinWorkspace(inviteCode, id);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.put("/regenerate-invite/:wsid", async (req, res) => {
  const { wsid } = req.params;
  const { id } = req.user!;

  const response = await regenerateInviteCode(wsid, id);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.put("/role/:wsid", async (req, res) => {
  const { wsid } = req.params;
  const { id } = req.user!;
  const { memberId, role } = req.body;

  const response = await updateMemberRole(wsid, id, memberId, role);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.delete("/leave/:wsid", async (req, res) => {
  const { wsid } = req.params;
  const { id } = req.user!;
  const { memberId } = req.body;

  const response = await removeMember(wsid, id, memberId);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.put("/update/:wsid", async (req, res) => {
  const { wsid } = req.params;
  const { id } = req.user!;
  const { name, description } = req.body;

  const response = await updateWorkspace(wsid, id, name, description);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.delete("/delete/:wsid", async (req, res) => {
  const { wsid } = req.params;
  const { id } = req.user!;

  const response = await deleteWorkspace(wsid, id);

  return res.status(response.statusCode).json(response);
});

workspaceRouter.get("/:slugId", async (req, res) => {
  const { slugId } = req.params;
  const { id } = req.user!;

  const response = await getWorkspaceBySlugId(slugId, id);

  return res.status(response.statusCode).json(response);
});

export default workspaceRouter;
