-- CreateEnum
CREATE TYPE "AiCallSource" AS ENUM ('BYOK', 'FREE');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('OK', 'ERROR', 'REFUSED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiFeature" ADD VALUE 'VISION';
ALTER TYPE "AiFeature" ADD VALUE 'TRANSCRIPTION';
ALTER TYPE "AiFeature" ADD VALUE 'SPEECH';
ALTER TYPE "AiFeature" ADD VALUE 'MEETING';

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "freeVoiceSecondsUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "workspace_ai_credential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "label" TEXT,
    "keyEnvelope" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "maskedPreview" TEXT NOT NULL,
    "verifiedKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validatedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "workspace_ai_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_ai_preference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelSource" TEXT NOT NULL DEFAULT 'registry',
    "modelCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "voice" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_ai_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_ai_settings" (
    "workspaceId" TEXT NOT NULL,
    "monthlySpendCapUsd" DECIMAL(10,2),
    "assistantEnabled" BOOLEAN NOT NULL DEFAULT true,
    "assistantSpeaks" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_ai_settings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "ai_call" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "feature" "AiFeature" NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "source" "AiCallSource" NOT NULL,
    "status" "AiCallStatus" NOT NULL,
    "errorReason" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "audioSeconds" DOUBLE PRECISION,
    "characters" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "costUsd" DECIMAL(12,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_ai_credential_workspaceId_idx" ON "workspace_ai_credential"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_ai_credential_workspaceId_providerId_key" ON "workspace_ai_credential"("workspaceId", "providerId");

-- CreateIndex
CREATE INDEX "workspace_ai_preference_workspaceId_idx" ON "workspace_ai_preference"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_ai_preference_workspaceId_feature_key" ON "workspace_ai_preference"("workspaceId", "feature");

-- CreateIndex
CREATE INDEX "ai_call_workspaceId_createdAt_idx" ON "ai_call"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "workspace_ai_credential" ADD CONSTRAINT "workspace_ai_credential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_ai_credential" ADD CONSTRAINT "workspace_ai_credential_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_ai_preference" ADD CONSTRAINT "workspace_ai_preference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_ai_preference" ADD CONSTRAINT "workspace_ai_preference_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_ai_settings" ADD CONSTRAINT "workspace_ai_settings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_call" ADD CONSTRAINT "ai_call_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_call" ADD CONSTRAINT "ai_call_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
