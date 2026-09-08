/**
 * @module validations/workspace
 * @description Zod schemas for creating and joining workspaces.
 */

import { z } from "zod";

/** Payload for creating a new workspace (creator becomes OWNER). */
export const workspaceSchema = z.object({
  name: z
    .string()
    .min(3, "Workspace name must be at least 3 characters")
    .max(25, "Workspace name must be at most 25 characters"),
  description: z
    .string()
    .max(255, "Description must be at most 255 characters")
    .optional(),
});

/** Payload for joining an existing workspace via its invite code. */
export const workspaceJoinSchema = z.object({
  inviteCode: z.string(),
});
