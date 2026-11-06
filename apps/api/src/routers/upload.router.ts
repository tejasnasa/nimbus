/**
 * @module api/routers/upload
 * @description Signed-upload endpoints for avatar assets
 * (`GET /api/upload/avatar-signature`) and chat images
 * (`GET /api/upload/chat-image-signature`). `authCheck` is mounted one level
 * up in `master.router`; `req.user` is guaranteed present.
 */
import express from "express";
import { chatImageSignatureQuerySchema, ServerResponse } from "@nimbus/types";
import {
  getAvatarSignature,
  getChatImageUploadSignature,
} from "../controllers/upload.controller";

const uploadRouter = express.Router();

uploadRouter.get("/avatar-signature", async (req, res) => {
  const { id } = req.user!;
  const response = await getAvatarSignature(id);

  // The signature is time-boxed (Cloudinary rejects after ~1h), so a
  // cached copy cannot be used past its expiry.
  res.set("Cache-Control", "no-store");

  return res.status(response.statusCode).json(response);
});

/** GET /api/upload/chat-image-signature?workspaceId= — members only. */
uploadRouter.get("/chat-image-signature", async (req, res) => {
  const { id } = req.user!;
  res.set("Cache-Control", "no-store");

  const query = chatImageSignatureQuerySchema.safeParse(req.query);
  if (!query.success) {
    const response = ServerResponse.badRequest("workspaceId is required");
    return res.status(response.statusCode).json(response);
  }

  const response = await getChatImageUploadSignature(
    id,
    query.data.workspaceId,
  );

  return res.status(response.statusCode).json(response);
});

export default uploadRouter;
