-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('LIVE', 'ENDED', 'SUMMARIZED', 'FAILED');

-- AlterTable
ALTER TABLE "ai_call" ADD COLUMN     "meetingId" TEXT;

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'LIVE',
    "startedById" TEXT,
    "source" "AiCallSource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "budgetSeconds" INTEGER,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segment" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "speakerUserId" TEXT,
    "speakerName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_segment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_startedAt_idx" ON "Meeting"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");

-- CreateIndex
CREATE INDEX "transcript_segment_meetingId_startMs_idx" ON "transcript_segment"("meetingId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "transcript_segment_meetingId_seq_key" ON "transcript_segment"("meetingId", "seq");

-- CreateIndex
CREATE INDEX "ai_call_meetingId_idx" ON "ai_call"("meetingId");

-- AddForeignKey
ALTER TABLE "ai_call" ADD CONSTRAINT "ai_call_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_speakerUserId_fkey" FOREIGN KEY ("speakerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one live meeting per workspace. Prisma cannot declare a partial unique
-- index, so it lives here; concurrent starts race on it and the loser re-reads
-- the winner. A later `migrate dev` may propose dropping it, which must be
-- declined.
CREATE UNIQUE INDEX "Meeting_workspaceId_live_key" ON "Meeting"("workspaceId") WHERE "status" = 'LIVE';
