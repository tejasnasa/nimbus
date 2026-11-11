/**
 * @module api/lib/meeting/search
 * @description Keyword search across a workspace's meeting transcripts.
 *
 * The query is parsed by `websearch_to_tsquery('simple', ...)`, which reads
 * ordinary search syntax (quoted phrases, `or`, a leading `-`) and never
 * raises on odd input, and is matched against the generated, GIN-indexed
 * `search` column. Each hit carries a `ts_headline` excerpt with the matched
 * words wrapped in `<mark>` tags.
 *
 * @important Every value reaches SQL as a bound parameter of a tagged
 *            `$queryRaw` template. Nothing from the caller is concatenated into
 *            the statement, and the workspace filter is part of the join, so a
 *            query can never read another workspace's transcripts.
 *
 * @important The `simple` configuration does no stemming and has no stop words:
 *            "deploy" does not match "deployed". That is deliberate, since
 *            captions are multilingual and a language-specific stemmer would
 *            be wrong for most of them.
 */
import { prisma } from "@nimbus/db";
import type { SegmentSearchHitDTO } from "@nimbus/types";

/** Options of {@link searchSegments}. */
export type SearchOptions = {
  /** Only meetings that started within this many days. */
  sinceDays?: number;
  /** Most hits to return. */
  limit?: number;
  /** The clock in milliseconds. Tests only. */
  now?: () => number;
};

/** The most hits a search returns when no limit is given. */
export const SEARCH_DEFAULT_LIMIT = 20;

type Row = {
  segmentId: string;
  seq: number;
  speakerName: string;
  startMs: number;
  meetingId: string;
  title: string | null;
  startedAt: Date;
  snippet: string;
};

/**
 * Finds transcript segments in a workspace that match a query.
 *
 * @param workspaceId - The workspace to search; nothing outside it is read.
 * @param query - What to look for, in web-search syntax.
 * @param options - Time window and page size.
 * @returns The best matches first, then the most recent meeting.
 */
export async function searchSegments(
  workspaceId: string,
  query: string,
  options: SearchOptions = {},
): Promise<SegmentSearchHitDTO[]> {
  const limit = options.limit ?? SEARCH_DEFAULT_LIMIT;
  const since =
    options.sinceDays === undefined
      ? null
      : new Date(
          (options.now ?? Date.now)() - options.sinceDays * 86_400_000,
        ).toISOString();

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      s."id" AS "segmentId",
      s."seq",
      s."speakerName",
      s."startMs",
      m."id" AS "meetingId",
      m."title",
      m."startedAt",
      ts_headline(
        'simple',
        s."text",
        q."query",
        'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=12, MaxFragments=1'
      ) AS "snippet"
    FROM "transcript_segment" s
    JOIN "Meeting" m ON m."id" = s."meetingId"
    CROSS JOIN LATERAL (
      SELECT websearch_to_tsquery('simple', ${query}) AS "query"
    ) q
    WHERE m."workspaceId" = ${workspaceId}
      AND s."search" @@ q."query"
      AND (${since}::timestamp IS NULL OR m."startedAt" >= ${since}::timestamp)
    ORDER BY ts_rank(s."search", q."query") DESC, m."startedAt" DESC, s."seq" ASC
    LIMIT ${limit}::int
  `;

  return rows.map((row) => ({
    meetingId: row.meetingId,
    meetingTitle: row.title,
    meetingStartedAt: row.startedAt.toISOString(),
    segmentId: row.segmentId,
    seq: row.seq,
    speakerName: row.speakerName,
    startMs: row.startMs,
    snippet: row.snippet,
  }));
}
