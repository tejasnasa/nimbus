/**
 * @module validations/voice
 * @description Zod schema for the call-token request, shared by the API route
 * and the web provider so the two cannot drift.
 */

import { z } from "zod";

/** Body of `POST /api/voice/token`: the workspace whose call to join. */
export const voiceTokenSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
});
