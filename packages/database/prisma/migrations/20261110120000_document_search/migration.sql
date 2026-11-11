-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "searchText" TEXT;

-- AlterTable
-- Generated, so it can never drift from "searchText" or "title"; Prisma only knows the column by type.
ALTER TABLE "Document" ADD COLUMN     "search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("searchText", '') || ' ' || "title")) STORED;

-- CreateIndex
CREATE INDEX "Document_search_idx" ON "Document" USING GIN ("search");
