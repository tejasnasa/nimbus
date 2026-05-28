import express from "express";
import authCheck from "../middleware/authCheck.middleware";
import documentRouter from "./document.router";
import messageRouter from "./message.router";
import turnRouter from "./turn.router";
import workspaceRouter from "./workspace.router";

const masterRouter = express.Router();

masterRouter.use("/workspace", authCheck, workspaceRouter);
masterRouter.use("/messages", authCheck, messageRouter);
masterRouter.use("/document", authCheck, documentRouter);
masterRouter.use("/turn", authCheck, turnRouter);

export default masterRouter;
