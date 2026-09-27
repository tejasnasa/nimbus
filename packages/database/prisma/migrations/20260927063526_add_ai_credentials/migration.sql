-- Add the AI credential store and the free-tier quota column.
--
-- One-way door on the backfill: every user that already existed at the moment
-- this migration ran has `freeDocGenerationsUsed = 5`, so the operator stops
-- paying for accounts that already had the free ride. New users start at 0 and
-- get the trial as they go. Reversing the backfill is not something a
-- `migrate rollback` does, so the choice is documented in `byok_plan.md` §3
-- and was made before this migration was applied.

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('CHAT', 'MARKDOWN', 'CANVAS');

-- AlterTable
ALTER TABLE "user" ADD COLUMN "freeDocGenerationsUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ai_credential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "label" TEXT,
    "keyEnvelope" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "maskedPreview" TEXT NOT NULL,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ai_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feature_preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_feature_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_credential_userId_idx" ON "ai_credential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credential_userId_providerId_key" ON "ai_credential"("userId", "providerId");

-- CreateIndex
CREATE INDEX "ai_feature_preference_userId_idx" ON "ai_feature_preference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_feature_preference_userId_feature_key" ON "ai_feature_preference"("userId", "feature");

-- AddForeignKey
ALTER TABLE "ai_credential" ADD CONSTRAINT "ai_credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feature_preference" ADD CONSTRAINT "ai_feature_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing users have already had unlimited free document generation
-- on the operator's key. Mark them as already at the limit so the operator
-- stops paying for accounts that already had the free ride. Users created at
-- or after this migration runs start at the column default of 0.
UPDATE "user" SET "freeDocGenerationsUsed" = 5 WHERE "createdAt" < TIMESTAMP '2026-09-27 06:35:26';
