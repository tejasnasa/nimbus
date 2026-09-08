/**
 * @module api/types/express
 * @description Global Express type augmentation. Extends `Request` with the
 * optional better-auth `User` populated by `authCheck.middleware` — handlers
 * behind `authCheck` can treat `req.user` as defined.
 */
import { User } from "better-auth";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}
