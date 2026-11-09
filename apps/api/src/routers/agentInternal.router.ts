/**
 * @module api/routers/agentInternal
 * @description The voice agent's private API under `/internal/agent/*`:
 * `redeem`, `segments`, `state`, `usage` and `ended`. Spoken to only by the
 * agent worker, never by a browser.
 *
 * @important `POST /redeem` returns the only plaintext provider key in any HTTP
 *            response in this codebase. It is `Cache-Control: no-store`, and
 *            this router is excluded from request logging in `src/app.ts`; both
 *            must stay true. Failures of any kind are the same bare 401.
 *
 * @important Mounted in `src/app.ts` outside `master.router.ts` and outside
 *            `/api`, on its own bearer-secret and session-token guards instead
 *            of `authCheck`: the caller is a process, not a signed-in user. It
 *            must never be reachable through `/api`.
 */
import express from "express";
import type { Server } from "socket.io";
import {
  postEnded,
  postSegments,
  postState,
  postUsage,
  redeem,
} from "../controllers/agentInternal.controller";
import {
  noStore,
  redeemRateLimit,
  requireAgentSecret,
  requireAgentSession,
} from "../middleware/agentAuth.middleware";

const agentInternalRouter = express.Router();

agentInternalRouter.use(noStore);

agentInternalRouter.post(
  "/redeem",
  redeemRateLimit,
  requireAgentSecret,
  async (req, res) => {
    const io = req.app.get("io") as Server | undefined;
    const response = await redeem(req.body, { io });
    return res.status(response.statusCode).json(response);
  },
);

agentInternalRouter.use(requireAgentSecret, requireAgentSession);

agentInternalRouter.post("/segments", async (req, res) => {
  const io = req.app.get("io") as Server | undefined;
  const response = await postSegments(req.agentSession!, req.body, { io });
  return res.status(response.statusCode).json(response);
});

agentInternalRouter.post("/state", async (req, res) => {
  const io = req.app.get("io") as Server | undefined;
  const response = await postState(req.agentSession!, req.body, { io });
  return res.status(response.statusCode).json(response);
});

agentInternalRouter.post("/usage", async (req, res) => {
  const io = req.app.get("io") as Server | undefined;
  const response = await postUsage(req.agentSession!, req.body, { io });
  return res.status(response.statusCode).json(response);
});

agentInternalRouter.post("/ended", async (req, res) => {
  const io = req.app.get("io") as Server | undefined;
  const response = await postEnded(req.agentSession!, req.body, { io });
  return res.status(response.statusCode).json(response);
});

export default agentInternalRouter;
