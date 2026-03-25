import { z } from "zod";

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

export const workspaceJoinSchema = z.object({
  inviteCode: z.string(),
});
