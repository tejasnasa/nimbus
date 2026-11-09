/**
 * @module api/types/express
 * @description Global Express type augmentation. Extends `Request` with the
 * optional better-auth `User` populated by `authCheck.middleware` — handlers
 * behind `authCheck` can treat `req.user` as defined.
 */
import { User } from "better-auth";
import type { AgentSession } from "../lib/meeting/agentSession";
import type { MeetingRow } from "../lib/meeting/lifecycle";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      /** Set by `requireAgentSession` on the internal agent routes. */
      agentSession?: { session: AgentSession; meeting: MeetingRow };
    }
  }
}
