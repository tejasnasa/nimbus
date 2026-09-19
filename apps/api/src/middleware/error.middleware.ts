/**
 * @module api/middleware/error
 * @description Terminal handlers that keep every response — including the
 * failures — in the `ServerResponse` envelope.
 *
 * Without these, Express falls back to its own HTML pages in two cases: an
 * unknown `/api/*` path answers `text/html`, and a throw that escapes a
 * controller's `try` leaks an HTML stack page. A client that parses every
 * response as the envelope then reports a JSON parse error instead of the
 * status it was actually given.
 *
 * @important Both must be registered after every route. The 404 must also sit
 *            after the better-auth mount at `/api/auth/{*any}`, or unknown auth
 *            paths are shadowed by a 404; the error handler is a four-argument
 *            middleware and is only reached as the last one.
 */
import { ServerResponse } from "@nimbus/types";
import type { ErrorRequestHandler, Request, Response } from "express";

/**
 * Answers an unmatched `/api/*` request with the standard envelope.
 *
 * Scoped to the `/api` prefix so non-API paths — the root health string today,
 * anything else later — keep Express's default behaviour.
 */
export const apiNotFoundHandler = (req: Request, res: Response): void => {
  res
    .status(404)
    .json(ServerResponse.notFound(`Cannot ${req.method} ${req.originalUrl}`));
};

/**
 * Converts an unhandled throw into the standard envelope.
 *
 * Controllers return their own error responses, so reaching this means the
 * failure happened outside their `try`. The error is logged in full and never
 * serialised to the client, which only learns that the request failed.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // Response already started: hand back to Express, which closes the connection
  // rather than letting a second `json()` throw over a partial write.
  if (res.headersSent) return next(err);

  console.error("Unhandled error:", err);
  res
    .status(500)
    .json(ServerResponse.internalError(null, "Internal Server Error"));
};
