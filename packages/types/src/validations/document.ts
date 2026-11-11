/**
 * @module validations/document
 * @description Zod schemas for creating, renaming and searching documents.
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

/** Longest title a rename accepts. */
export const DOCUMENT_TITLE_MAX = 100;

/** Body of `PATCH /api/document/:docId`. */
export const documentRenameSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title cannot be empty")
    .max(
      DOCUMENT_TITLE_MAX,
      `Title must be at most ${DOCUMENT_TITLE_MAX} characters`,
    ),
});

/** Largest page of document search hits. */
export const DOCUMENT_SEARCH_MAX = 50;

/** Query of `GET /api/document/search`. */
export const documentSearchQuerySchema = z.object({
  workspaceId: z.string().min(1).max(64),
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(DOCUMENT_SEARCH_MAX).default(20),
});
