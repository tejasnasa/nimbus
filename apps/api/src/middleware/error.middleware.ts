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
 * Status carried by a thrown middleware error, or 500 when it carries none.
 *
 * Middleware generally signals a client mistake by throwing an error with a
 * `status` — `express.json()` rejects malformed JSON with 400 and an oversized
 * body with 413. Mapping those to 500 would report the caller's mistake as a
 * server fault, which is the misreporting this handler exists to remove.
 */
const statusOf = (err: unknown) => {
  const carried =
    typeof err === "object" && err !== null
      ? ((err as { status?: unknown; statusCode?: unknown }).status ??
        (err as { statusCode?: unknown }).statusCode)
      : undefined;

  return typeof carried === "number" && carried >= 400 && carried <= 599
    ? carried
    : 500;
};

/**
 * Converts an unhandled throw into the standard envelope.
 *
 * Controllers return their own error responses, so reaching this means the
 * failure happened outside their `try`. A 4xx is passed through with the
 * middleware's own message, since knowing *why* the request was rejected is the
 * useful part; a 5xx is logged in full and answered generically, so nothing
 * internal is serialised to the client.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // Response already started: hand back to Express, which closes the connection
  // rather than letting a second `json()` throw over a partial write.
  if (res.headersSent) return next(err);

  const statusCode = statusOf(err);

  if (statusCode >= 500) {
    console.error("Unhandled error:", err);
  } else {
    console.error(`Rejected request (${statusCode}):`, err);
  }

  const message =
    statusCode >= 500
      ? "Internal Server Error"
      : err instanceof Error
        ? err.message
        : "Bad Request";

  // Statuses without a factory (413 among them) still go through the envelope
  // class rather than a hand-rolled object, so the shape stays uniform.
  const response =
    statusCode >= 500
      ? ServerResponse.internalError(null, message)
      : new ServerResponse(false, message, null, statusCode);

  res.status(statusCode).json(response);
};
