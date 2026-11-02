-- AlterTable
ALTER TABLE "ai_feature_preference" ADD COLUMN     "modelCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "modelSource" TEXT NOT NULL DEFAULT 'registry';
