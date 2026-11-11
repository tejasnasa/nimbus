/**
 * @module api/routers/actionItem
 * @description Authenticated action item endpoints under `/api/action-items`:
 * `GET /` (a workspace's items), `PATCH /:id` and `DELETE /:id`. Membership and
 * permission enforcement live in the controller.
 */
import { actionItemPatchSchema } from "@nimbus/types";
import express from "express";
import type { Server } from "socket.io";
import {
  deleteActionItem,
  listActionItems,
  patchActionItem,
} from "../controllers/actionItem.controller";
import validate from "../middleware/validate.middleware";

const actionItemRouter = express.Router();

actionItemRouter.get("/", async (req, res) => {
  const response = await listActionItems(req.user!.id, req.query);
  return res.status(response.statusCode).json(response);
});

actionItemRouter.patch(
  "/:id",
  validate(actionItemPatchSchema),
  async (req, res) => {
    const io = req.app.get("io") as Server | undefined;
    const response = await patchActionItem(
      req.user!.id,
      req.params.id,
      req.body,
      { io },
    );
    return res.status(response.statusCode).json(response);
  },
);

actionItemRouter.delete("/:id", async (req, res) => {
  const io = req.app.get("io") as Server | undefined;
  const response = await deleteActionItem(req.user!.id, req.params.id, { io });
  return res.status(response.statusCode).json(response);
});

export default actionItemRouter;
