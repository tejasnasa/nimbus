import express from "express";
import workspaceRouter from "./workspace.router";
import authCheck from "../middleware/authCheck.middleware";
import messageRouter from "./message.router";
import documentRouter from "./document.router";

const masterRouter = express.Router();

masterRouter.use("/workspace", authCheck, workspaceRouter);
masterRouter.use("/messages", authCheck, messageRouter)
masterRouter.use("/document", authCheck, documentRouter);


export default masterRouter;
