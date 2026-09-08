/**
 * @module api/middleware/authCheck
 * @description REST session guard. Resolves the better-auth session from
 * request headers, rejects unauthenticated callers with 401, and augments
 * `req.user` (see `src/types/express.d.ts`) for downstream controllers.
 */
import { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth";
import { ServerResponse } from "@nimbus/types";

/**
 * Validates the caller's session and attaches the user to the request.
 *
 * @param req - Express request; `req.user` is populated on success.
 * @param res - Express response (401 when no valid session exists).
 * @param next - Passes control to the next middleware/controller.
 * @returns The 401 response on failure, otherwise void via `next()`.
 */
const authCheck = async (req: Request, res: Response, next: NextFunction) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    const response = ServerResponse.unauthorized();
    return res.status(response.statusCode).json(response);
  }

  req.user = session.user;
  next();
};

export default authCheck;
