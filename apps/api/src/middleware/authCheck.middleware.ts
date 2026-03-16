import { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../utils/auth";
import { ServerResponse } from "../models/serverResponse";

const authCheck = async (req: Request, res: Response, next: NextFunction) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    const response = new ServerResponse(false, "Unauthorized", null, 401);

    return res.status(401).json(response);
  }
  req.body.user = session.user;
  next();
};

export default authCheck;
