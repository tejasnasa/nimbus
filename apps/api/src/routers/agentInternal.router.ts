/**
 * @module api/routers/agentInternal
 * @description The voice agent's private API under `/internal/agent/*`:
 * `redeem`, `segments`, `state`, `answer`, `notice`, `usage` and `ended`.
 * Spoken to only by the agent worker, never by a browser.
 *
 * `answer` is the one streamed route: it writes `application/x-ndjson` lines as
 * the reply is generated, and an agent that hangs up mid-answer cancels it.
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
  postAnswer,
  postEnded,
  postNotice,
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

agentInternalRouter.post("/answer", async (req, res) => {
  const io = req.app.get("io") as Server | undefined;
  const hangUp = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) hangUp.abort();
  });
  const early = await postAnswer(
    req.agentSession!,
    req.body,
    {
      open: () => {
        res.status(200);
        res.setHeader("content-type", "application/x-ndjson");
        res.setHeader("x-accel-buffering", "no");
        res.flushHeaders();
      },
      write: (line) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`);
      },
      signal: hangUp.signal,
    },
    { io },
  );
  if (early) return res.status(early.statusCode).json(early);
  return res.end();
});

agentInternalRouter.post("/notice", async (req, res) => {
  const io = req.app.get("io") as Server | undefined;
  const response = await postNotice(req.agentSession!, req.body, { io });
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
