import express from "express";

const workspaceRouter = express.Router();

workspaceRouter.get("/", (req, res) => {
  res.json({ message: "Welcome to the workspace API!" });
});

export default workspaceRouter;
