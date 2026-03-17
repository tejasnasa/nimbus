import { ServerResponse } from "@nimbus/types";
import { Request, Response, NextFunction } from "express";
import { z, ZodSchema } from "zod";

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
