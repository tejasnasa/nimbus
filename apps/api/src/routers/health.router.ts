/**
 * @module api/routers/health
 * @description Public liveness probe (`GET /api/health`).
 *
 * @important Mounted in `src/app.ts` ahead of the guarded routers, alongside
 *            `/api/contact`, rather than in `master.router.ts` — an uptime
 *            monitor cannot hold a session, and keeping it out of the master
 *            router preserves that router's "everything under it is
 *            authenticated" invariant. Do not move it.
 */
import express from "express";
import { getHealth } from "../controllers/health.controller";

const healthRouter = express.Router();

healthRouter.get("/", async (req, res) => {
  const response = await getHealth();

  return res.status(response.statusCode).json(response);
});

export default healthRouter;
