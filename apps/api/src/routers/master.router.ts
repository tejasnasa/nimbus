import express from "express";
import workspaceRouter from "./workspace.router";
import authCheck from "../middleware/authCheck.middleware";

const masterRouter = express.Router();

masterRouter.use("/workspace", authCheck, workspaceRouter);

export default masterRouter;