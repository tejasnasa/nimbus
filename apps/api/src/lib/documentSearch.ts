/**
 * @module api/lib/documentSearch
 * @description Keyword search across a workspace's documents, markdown and
 * canvas alike, over each document's title and the plain text kept in
 * `Document.searchText`.
 *
 * The query is parsed by `websearch_to_tsquery('simple', ...)`, which reads
 * ordinary search syntax (quoted phrases, `or`, a leading `-`) and never raises
 * on odd input, and is matched against the generated, GIN-indexed `search`
 * column. Each hit carries a `ts_headline` excerpt with the matched words
 * wrapped in `<mark>` tags.
 *
 * @important Every value reaches SQL as a bound parameter of a tagged
 *            `$queryRaw` template, and the workspace filter is part of the
 *            statement, so a query can never read another workspace's
 *            documents.
 *
 * @important The `simple` configuration does no stemming and has no stop words:
 *            "deploy" does not match "deployed". Documents are written in any
 *            language, so a language-specific stemmer would be wrong for most.
 *
 * @important The excerpt is built only for the rows that survive the limit.
 *            Building it is the costly part, and a document's text can be
 *            large.
 */
import { prisma } from "@nimbus/db";
import type { DocumentSearchHitDTO } from "@nimbus/types";

/** Options of {@link searchDocuments}. */
export type DocumentSearchOptions = {
  /** Most hits to return. */
  limit?: number;
};

/** The most hits a search returns when no limit is given. */
export const DOCUMENT_SEARCH_DEFAULT_LIMIT = 20;

type Row = {
  id: string;
  title: string;
  type: string;
  updatedAt: Date;
  snippet: string;
};

/**
 * Finds documents in a workspace that match a query.
 *
 * @param workspaceId - The workspace to search; nothing outside it is read.
 * @param query - What to look for, in web-search syntax.
 * @param options - Page size.
 * @returns The best matches first, then the most recently edited.
 */
export async function searchDocuments(
  workspaceId: string,
  query: string,
  options: DocumentSearchOptions = {},
): Promise<DocumentSearchHitDTO[]> {
  const limit = options.limit ?? DOCUMENT_SEARCH_DEFAULT_LIMIT;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      hit."id",
      hit."title",
      hit."type",
      hit."updatedAt",
      ts_headline(
        'simple',
        hit."title" || ' - ' || coalesce(hit."searchText", ''),
        hit."query",
        'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=12, MaxFragments=1'
      ) AS "snippet"
    FROM (
      SELECT
        d."id",
        d."title",
        d."type"::text AS "type",
        d."updatedAt",
        d."searchText",
        q."query",
        ts_rank(d."search", q."query") AS "rank"
      FROM "Document" d
      CROSS JOIN LATERAL (
        SELECT websearch_to_tsquery('simple', ${query}) AS "query"
      ) q
      WHERE d."workspaceId" = ${workspaceId}
        AND d."search" @@ q."query"
      ORDER BY "rank" DESC, d."updatedAt" DESC
      LIMIT ${limit}::int
    ) hit
    ORDER BY hit."rank" DESC, hit."updatedAt" DESC
  `;

  return rows.map((row) => ({
    documentId: row.id,
    title: row.title,
    type: row.type === "MARKDOWN" ? "MARKDOWN" : "CANVAS",
    updatedAt: row.updatedAt.toISOString(),
    snippet: row.snippet,
  }));
}
