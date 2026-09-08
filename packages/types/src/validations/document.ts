/**
 * @module validations/document
 * @description Zod schema for creating a document within a workspace.
 */

import { z } from "zod";

/** Payload for the create-document REST endpoint and form validation. */
export const documentSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(50, "Title must be at most 50 characters"),
  /** Kind of document to create — determines which editor opens. */
  type: z.enum(["CANVAS", "MARKDOWN"]),
  workspaceId: z.cuid(),
});
