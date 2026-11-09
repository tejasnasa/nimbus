/**
 * @module api/routers/master
 * @description Top-level `/api` composition: mounts the domain routers,
 * each behind `authCheck` so every REST endpoint is authenticated by default.
 * (better-auth's own `/api/auth/*` is mounted separately in `src/index.ts`.)
 */
import express from "express";
import authCheck from "../middleware/authCheck.middleware";
import aiRouter from "./ai.router";
import documentRouter from "./document.router";
import meetingRouter from "./meeting.router";
import messageRouter from "./message.router";
import uploadRouter from "./upload.router";
import voiceRouter from "./voice.router";
import workspaceRouter from "./workspace.router";

const masterRouter = express.Router();

masterRouter.use("/ai", authCheck, aiRouter);
masterRouter.use("/workspace", authCheck, workspaceRouter);
masterRouter.use("/messages", authCheck, messageRouter);
masterRouter.use("/document", authCheck, documentRouter);
masterRouter.use("/upload", authCheck, uploadRouter);
masterRouter.use("/voice", authCheck, voiceRouter);
masterRouter.use("/meetings", authCheck, meetingRouter);

export default masterRouter;
