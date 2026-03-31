import { z } from "zod";

export const documentSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(50, "Title must be at most 50 characters"),
  type: z.enum(["CANVAS", "MARKDOWN"]),
  workspaceId: z.string().uuid().optional(),
});
