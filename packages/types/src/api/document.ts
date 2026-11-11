/**
 * @module api/document
 * @description Wire shapes of the document endpoints and socket events that
 * carry no document body: the list-row summary announced to a workspace, and
 * the search and export responses.
 */

/** A document without its body, as announced to the workspace room. */
export type DocumentSummaryDTO = {
  id: string;
  title: string;
  type: "CANVAS" | "MARKDOWN";
  workspaceId: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
};

/** One document that matched a keyword search. */
export type DocumentSearchHitDTO = {
  documentId: string;
  title: string;
  type: "CANVAS" | "MARKDOWN";
  /** ISO timestamp. */
  updatedAt: string;
  /**
   * An excerpt of the title and body with the matched words wrapped in `<mark>`
   * and `</mark>`. Everything else is raw document text, not HTML: render it as
   * text and treat only those two tags as markup.
   */
  snippet: string;
};

/** `GET /api/document/search`. */
export type DocumentSearchDTO = {
  hits: DocumentSearchHitDTO[];
};

/**
 * `GET /api/document/:docId/export`. A markdown document carries its text; a
 * canvas carries its element array for the client to render.
 */
export type DocumentExportDTO =
  | { type: "MARKDOWN"; title: string; markdown: string }
  | { type: "CANVAS"; title: string; elements: unknown[] };
