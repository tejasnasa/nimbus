-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CANVAS', 'MARKDOWN');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "type" "DocumentType" NOT NULL DEFAULT 'CANVAS',
ADD COLUMN     "yjsState" BYTEA;
