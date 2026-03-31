import { documentSchema } from "@nimbus/types";
import express from "express";
import validate from "../middleware/validate.middleware";
import {
  createDocument,
  deleteDocument,
  getDocument,
  getWorkspaceDocuments,
} from "../controllers/document.controller";

const documentRouter = express.Router();

documentRouter.post("/create", validate(documentSchema), async (req, res) => {
  const { id } = req.user!;
  const { title, workspaceId, type } = req.body;

  const response = await createDocument(title, workspaceId, id, type);

  return res.status(response.statusCode).json(response);
});

documentRouter.get("/workspace/:workspaceId", async (req, res) => {
  const { id } = req.user!;
  const { workspaceId } = req.params;

  const response = await getWorkspaceDocuments(workspaceId, id);

  return res.status(response.statusCode).json(response);
});

documentRouter.get("/:docId", async (req, res) => {
  const { id } = req.user!;
  const { docId } = req.params;

  const response = await getDocument(docId, id);

  return res.status(response.statusCode).json(response);
});

documentRouter.delete("/:docId", async (req, res) => {
  const { id } = req.user!;
  const { docId } = req.params;

  const response = await deleteDocument(docId, id);

  return res.status(response.statusCode).json(response);
});

export default documentRouter;
