import { z } from "zod";

export const workspaceSchema = z.object({
  name: z
    .string()
    .min(3, "Workspace name must be at least 3 characters")
    .max(25, "Workspace name must be at most 25 characters"),
});
