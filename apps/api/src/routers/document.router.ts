/**
 * @module api/routers/document
 * @description Document REST endpoints (`/api/document/*`): create (Zod
 * validated), list-by-workspace, keyword search, fetch-one, rename (`PATCH`),
 * export and delete. Membership and delete-role checks live in the controller
 * layer.
 *
 * @important Route order matters: `/search` and `/workspace/:workspaceId` are
 *            registered before `/:docId`, which would otherwise take `search`
 *            as a document id.
 */
import { documentRenameSchema, documentSchema } from "@nimbus/types";
import express from "express";
import type { Server } from "socket.io";
import validate from "../middleware/validate.middleware";
import {
  createDocument,
  deleteDocument,
  exportDocument,
  getDocument,
  getWorkspaceDocuments,
  renameDocument,
  searchWorkspaceDocuments,
} from "../controllers/document.controller";

const documentRouter = express.Router();

documentRouter.post("/create", validate(documentSchema), async (req, res) => {
  const { id } = req.user!;
  const { title, workspaceId, type } = req.body;

  const io = req.app.get("io") as Server | undefined;
  const response = await createDocument(title, workspaceId, id, type, io);

  return res.status(response.statusCode).json(response);
});

documentRouter.get("/workspace/:workspaceId", async (req, res) => {
  const { id } = req.user!;
  const { workspaceId } = req.params;

  const response = await getWorkspaceDocuments(workspaceId, id);

  return res.status(response.statusCode).json(response);
});

documentRouter.get("/search", async (req, res) => {
  const response = await searchWorkspaceDocuments(req.user!.id, req.query);

  return res.status(response.statusCode).json(response);
});

documentRouter.get("/:docId/export", async (req, res) => {
  const response = await exportDocument(req.params.docId, req.user!.id);

  return res.status(response.statusCode).json(response);
});

documentRouter.patch(
  "/:docId",
  validate<{ docId: string }>(documentRenameSchema),
  async (req, res) => {
    const io = req.app.get("io") as Server | undefined;
    const response = await renameDocument(
      req.params.docId,
      req.user!.id,
      // The schema trims, but the parsed value is not forwarded.
      String(req.body.title).trim(),
      io,
    );

    return res.status(response.statusCode).json(response);
  },
);

documentRouter.get("/:docId", async (req, res) => {
  const { id } = req.user!;
  const { docId } = req.params;

  const response = await getDocument(docId, id);

  return res.status(response.statusCode).json(response);
});

documentRouter.delete("/:docId", async (req, res) => {
  const { id } = req.user!;
  const { docId } = req.params;

  const io = req.app.get("io") as Server | undefined;
  const response = await deleteDocument(docId, id, io);

  return res.status(response.statusCode).json(response);
});

export default documentRouter;
