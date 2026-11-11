/**
 * @module api/routers/meeting
 * @description Authenticated assistant endpoints under `/api/meetings`:
 * `POST /assistant/start`, `POST /:meetingId/assistant/stop`, `GET /` (the
 * workspace's meetings), `GET /live`, `GET /search`, `GET /:meetingId`,
 * `GET /:meetingId/segments`, `GET /:meetingId/catch-up`,
 * `POST /:meetingId/diagram` and `DELETE /:meetingId`. Membership enforcement
 * lives in the controller.
 *
 * @important Route order matters: `/live` and `/search` are registered before
 *            `/:meetingId`, which would otherwise take them as a meeting id.
 */
import { assistantStartSchema } from "@nimbus/types";
import express from "express";
import type { Server } from "socket.io";
import {
  deleteMeeting,
  getLiveMeeting,
  getMeetingCatchUp,
  getMeetingDetail,
  listMeetings,
  listSegments,
  searchMeetingTranscripts,
  startAssistant,
  startMeetingDiagram,
  stopAssistant,
} from "../controllers/meeting.controller";
import validate from "../middleware/validate.middleware";

const meetingRouter = express.Router();

meetingRouter.post(
  "/assistant/start",
  validate(assistantStartSchema),
  async (req, res) => {
    const io = req.app.get("io") as Server | undefined;
    const response = await startAssistant(req.user!, req.body, { io });
    return res.status(response.statusCode).json(response);
  },
);

meetingRouter.get("/", async (req, res) => {
  const response = await listMeetings(req.user!.id, req.query);
  return res.status(response.statusCode).json(response);
});

meetingRouter.get("/live", async (req, res) => {
  const response = await getLiveMeeting(req.user!.id, req.query);
  return res.status(response.statusCode).json(response);
});

meetingRouter.get("/search", async (req, res) => {
  const response = await searchMeetingTranscripts(req.user!.id, req.query);
  return res.status(response.statusCode).json(response);
});

meetingRouter.get("/:meetingId", async (req, res) => {
  const response = await getMeetingDetail(req.user!.id, req.params.meetingId);
  return res.status(response.statusCode).json(response);
});

meetingRouter.post("/:meetingId/assistant/stop", async (req, res) => {
  const io = req.app.get("io") as Server | undefined;
  const response = await stopAssistant(req.user!.id, req.params.meetingId, {
    io,
  });
  return res.status(response.statusCode).json(response);
});

meetingRouter.get("/:meetingId/segments", async (req, res) => {
  const response = await listSegments(
    req.user!.id,
    req.params.meetingId,
    req.query,
  );
  return res.status(response.statusCode).json(response);
});

meetingRouter.get("/:meetingId/catch-up", async (req, res) => {
  const response = await getMeetingCatchUp(req.user!.id, req.params.meetingId);
  return res.status(response.statusCode).json(response);
});

meetingRouter.post("/:meetingId/diagram", async (req, res) => {
  const io = req.app.get("io") as Server | undefined;
  const response = await startMeetingDiagram(
    req.user!.id,
    req.params.meetingId,
    {
      io,
    },
  );
  return res.status(response.statusCode).json(response);
});

meetingRouter.delete("/:meetingId", async (req, res) => {
  const io = req.app.get("io") as Server | undefined;
  const response = await deleteMeeting(req.user!.id, req.params.meetingId, {
    io,
  });
  return res.status(response.statusCode).json(response);
});

export default meetingRouter;
