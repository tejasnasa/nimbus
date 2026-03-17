import { z } from "zod";

export const workspaceSchemaApi = z.object({
  name: z
    .string()
    .min(3, "Workspace name must be at least 3 characters")
    .max(50, "Workspace name must be at most 50 characters"),

  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(50)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and hyphens",
    ),

  description: z
    .string()
    .max(200, "Description must be at most 200 characters")
    .optional(),
});

export const workspaceSchemaWeb = z.object({
  name: z
    .string()
    .min(3, "Workspace name must be at least 3 characters")
    .max(50, "Workspace name must be at most 50 characters"),

  description: z
    .string()
    .max(200, "Description must be at most 200 characters")
    .optional(),
});
