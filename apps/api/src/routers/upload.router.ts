/**
 * @module api/routers/upload
 * @description Signed-upload endpoint for avatar assets
 * (`GET /api/upload/avatar-signature`). `authCheck` is mounted one level
 * up in `master.router`; `req.user` is guaranteed present.
 */
import express from "express";
import { getAvatarSignature } from "../controllers/upload.controller";

const uploadRouter = express.Router();

uploadRouter.get("/avatar-signature", async (req, res) => {
  const { id } = req.user!;
  const response = await getAvatarSignature(id);

  // The signature is time-boxed (Cloudinary rejects after ~1h), so a
  // cached copy cannot be used past its expiry.
  res.set("Cache-Control", "no-store");

  return res.status(response.statusCode).json(response);
});

export default uploadRouter;
