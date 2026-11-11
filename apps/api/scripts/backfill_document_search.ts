/**
 * @module api/scripts/backfill_document_search
 * @description Fills `Document.searchText` for documents that existed before
 * keyword search. The work is in `src/lib/documentBackfill.ts`; this is the
 * command-line wrapper.
 *
 * Usage: `DATABASE_URL=<url> npx tsx scripts/backfill_document_search.ts [--dry-run] [--all]`
 *
 * @important `DATABASE_URL` must be set explicitly in the environment. No `.env`
 *            file is loaded, so the script can never reach a database by
 *            accident: the target is printed (host and database, never the
 *            credentials) before anything is read, and `--dry-run` reports what
 *            would change without writing.
 */
import {
  backfillDocumentSearch,
  parseBackfillArgs,
} from "../src/lib/documentBackfill";

async function main() {
  const args = parseBackfillArgs(process.argv.slice(2), process.env);
  if (!args.ok) {
    console.error(args.message);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Backfilling document search text on ${args.target} (${args.dryRun ? "dry run" : "writing"}, ${args.all ? "all documents" : "documents without text"}).`,
  );

  const { createPrismaClient } = await import("@nimbus/db");
  const db = createPrismaClient(args.url);
  try {
    await backfillDocumentSearch(db, {
      dryRun: args.dryRun,
      all: args.all,
      log: (line) => console.log(line),
    });
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
