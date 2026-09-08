/**
 * @module api/middleware/validate
 * @description Zod request-body validation factory. Parses `req.body` with
 * the given schema and short-circuits with a 400 `ServerResponse` on failure;
 * the parsed value is not forwarded — controllers re-read the (now trusted)
 * `req.body`.
 */
import { ServerResponse } from "@nimbus/types";
import { Request, Response, NextFunction } from "express";
import { z, ZodSchema } from "zod";

/**
 * Creates body-validation middleware for a Zod schema.
 *
 * @param schema - Zod schema the request body must satisfy.
 * @returns Express middleware that calls `next()` on success or sends a 400
 *          `ServerResponse` with treeified Zod errors on failure.
 */
const validate =
  (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = z.treeifyError(result.error);
      res
        .status(400)
        .json(new ServerResponse(false, "Validation failed", errors, 400));
      return;
    }

    next();
  };

export default validate;
