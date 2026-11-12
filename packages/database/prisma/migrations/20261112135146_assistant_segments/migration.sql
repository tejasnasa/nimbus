-- AlterTable
ALTER TABLE "transcript_segment" ADD COLUMN     "addressed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fromAssistant" BOOLEAN NOT NULL DEFAULT false;
