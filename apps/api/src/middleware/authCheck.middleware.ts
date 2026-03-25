import { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth";
import { ServerResponse } from "@nimbus/types";

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
