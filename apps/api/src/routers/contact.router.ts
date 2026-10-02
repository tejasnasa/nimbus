/**
 * @module api/routers/contact
 * @description Public contact-form endpoint (`POST /api/contact`). Mounted in
 * `src/app.ts` rather than in `master.router` because it carries no
 * `authCheck` — it is the only REST route in the app that answers an anonymous
 * caller, and keeping it out of the master router is what keeps that router's
 * "every route is authenticated" invariant literally true.
 */
import { contactSchema } from "@nimbus/types";
import express from "express";
import { submitContact } from "../controllers/contact.controller";
import validate from "../middleware/validate.middleware";

const contactRouter = express.Router();

/** POST /api/contact — validates the body, then hands it to the controller. */
contactRouter.post("/", validate(contactSchema), async (req, res) => {
  const response = await submitContact(req.body);

  return res.status(response.statusCode).json(response);
});

export default contactRouter;
