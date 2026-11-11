/**
 * @module api/lib/documentBackfill
 * @description Filling `Document.searchText` for documents stored before
 * keyword search existed: a markdown document's text is read from its Yjs state
 * (or its unconsumed markdown seed), a canvas's from its element array. Run by
 * `scripts/backfill_document_search.ts`; kept here so it can be tested in
 * process.
 *
 * @important {@link parseBackfillArgs} accepts only an explicit `DATABASE_URL`
 *            and never loads a `.env` file, so the script cannot reach a
 *            database by accident. The target it reports names the host and
 *            database only, never the credentials.
 *
 * @important By default only documents with no search text are touched, so a
 *            rerun is cheap and never overwrites text a live editor stored.
 *            `all` recomputes every document.
 */
import type { PrismaClient } from "@nimbus/db";
import {
  extractCanvasText,
  extractYjsStateText,
  markdownToText,
} from "./documentText";

/** How to run the script, printed whenever its input is unusable. */
export const BACKFILL_USAGE =
  "usage: DATABASE_URL=<postgres url> npx tsx scripts/backfill_document_search.ts [--dry-run] [--all]";

/** What the script was asked to do, or why it cannot start. */
export type BackfillArgs =
  | {
      ok: true;
      url: string;
      /** `host:port/database`, safe to print. */
      target: string;
      dryRun: boolean;
      all: boolean;
    }
  | { ok: false; message: string };

/**
 * Reads the script's arguments and environment.
 *
 * @param argv - Arguments after the script name.
 * @param env - The process environment.
 * @returns The run settings, or the message to print instead.
 */
export function parseBackfillArgs(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): BackfillArgs {
  const args = new Set(argv);
  const unknown = [...args].filter(
    (arg) => arg !== "--dry-run" && arg !== "--all",
  );
  const url = env.DATABASE_URL;
  if (!url || unknown.length > 0) return { ok: false, message: BACKFILL_USAGE };

  let target: string;
  try {
    const parsed = new URL(url);
    target = `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return {
      ok: false,
      message: `DATABASE_URL is not a valid URL.\n${BACKFILL_USAGE}`,
    };
  }
  return {
    ok: true,
    url,
    target,
    dryRun: args.has("--dry-run"),
    all: args.has("--all"),
  };
}

/** The Prisma surface the backfill uses. */
type BackfillDb = Pick<PrismaClient, "document">;

/**
 * Computes and (unless dry-running) stores search text for documents.
 *
 * @param db - Prisma client for the target database.
 * @param options - `dryRun` reports without writing; `all` includes documents
 *                  that already have text; `log` receives one line per step.
 * @returns How many documents were inspected and how many changed.
 */
export async function backfillDocumentSearch(
  db: BackfillDb,
  options: { dryRun: boolean; all: boolean; log: (line: string) => void },
): Promise<{ inspected: number; changed: number }> {
  const { dryRun, all, log } = options;
  const documents = await db.document.findMany({
    where: all ? {} : { searchText: null },
    select: {
      id: true,
      type: true,
      searchText: true,
      canvasData: true,
      yjsState: true,
      initialContent: true,
    },
  });
  log(`${documents.length} document(s) to inspect.`);

  let changed = 0;
  for (const document of documents) {
    let text = "";
    if (document.type === "CANVAS") {
      text = extractCanvasText(document.canvasData);
    } else {
      if (document.yjsState) text = extractYjsStateText(document.yjsState);
      if (!text && document.initialContent) {
        text = markdownToText(document.initialContent);
      }
    }
    const next = text || null;
    if (next === document.searchText) continue;
    changed += 1;
    log(
      `${dryRun ? "would update" : "update"} ${document.id} (${document.type}, ${text.length} chars)`,
    );
    if (!dryRun) {
      await db.document.update({
        where: { id: document.id },
        data: { searchText: next },
      });
    }
  }
  log(`${dryRun ? "Would update" : "Updated"} ${changed} document(s).`);
  return { inspected: documents.length, changed };
}
