-- CreateEnum
CREATE TYPE "ActionItemStatus" AS ENUM ('OPEN', 'DONE');

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "notesDocumentId" TEXT,
ADD COLUMN     "rollingSummary" TEXT,
ADD COLUMN     "rollingSummaryAt" TIMESTAMP(3),
ADD COLUMN     "rollingSummarySeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "summary" JSONB,
ADD COLUMN     "summaryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "title" TEXT;

-- AlterTable
-- Generated, so it can never drift from "text"; Prisma only knows the column by type.
ALTER TABLE "transcript_segment" ADD COLUMN     "search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "text")) STORED;

-- CreateIndex
CREATE INDEX "transcript_segment_search_idx" ON "transcript_segment" USING GIN ("search");

-- CreateTable
CREATE TABLE "action_item" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT,
    "text" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "ownerName" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "ActionItemStatus" NOT NULL DEFAULT 'OPEN',
    "sourceSegmentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "action_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sourceSegmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "action_item_workspaceId_status_idx" ON "action_item"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "action_item_ownerUserId_idx" ON "action_item"("ownerUserId");

-- CreateIndex
CREATE INDEX "action_item_meetingId_idx" ON "action_item"("meetingId");

-- CreateIndex
CREATE INDEX "decision_workspaceId_createdAt_idx" ON "decision"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "decision_meetingId_idx" ON "decision"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_notesDocumentId_key" ON "Meeting"("notesDocumentId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_notesDocumentId_fkey" FOREIGN KEY ("notesDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

