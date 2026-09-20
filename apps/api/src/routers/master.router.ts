/**
 * @module api/routers/master
 * @description Top-level `/api` composition: mounts the four domain routers,
 * each behind `authCheck` so every REST endpoint is authenticated by default.
 * (better-auth's own `/api/auth/*` is mounted separately in `src/index.ts`.)
 */
import express from "express";
import authCheck from "../middleware/authCheck.middleware";
import documentRouter from "./document.router";
import messageRouter from "./message.router";
import turnRouter from "./turn.router";
import uploadRouter from "./upload.router";
import workspaceRouter from "./workspace.router";

const masterRouter = express.Router();

masterRouter.use("/workspace", authCheck, workspaceRouter);
masterRouter.use("/messages", authCheck, messageRouter);
masterRouter.use("/document", authCheck, documentRouter);
masterRouter.use("/turn", authCheck, turnRouter);
masterRouter.use("/upload", authCheck, uploadRouter);

export default masterRouter;
