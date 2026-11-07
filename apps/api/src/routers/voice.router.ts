/**
 * @module api/routers/voice
 * @description Authenticated voice endpoints under `/api/voice`:
 * `POST /token` (join a workspace's call) and `GET /:workspaceId/roster`
 * (who is on it). Membership enforcement lives in the controller.
 *
 * @important The media server's webhook is not here. It is signed by the media
 *            server rather than authenticated by a session, so it lives in
 *            `livekitWebhook.router` and is mounted ahead of the guarded
 *            routers.
 */
import { voiceTokenSchema } from "@nimbus/types";
import express from "express";
import {
  createVoiceToken,
  getVoiceRoster,
} from "../controllers/voice.controller";
import validate from "../middleware/validate.middleware";

const voiceRouter = express.Router();

voiceRouter.post("/token", validate(voiceTokenSchema), async (req, res) => {
  const user = req.user!;
  const { workspaceId } = req.body;

  const response = await createVoiceToken(user, workspaceId);

  return res.status(response.statusCode).json(response);
});

voiceRouter.get("/:workspaceId/roster", async (req, res) => {
  const { id } = req.user!;
  const { workspaceId } = req.params;

  const response = await getVoiceRoster(id, workspaceId);

  return res.status(response.statusCode).json(response);
});

export default voiceRouter;
