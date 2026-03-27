/*
  Warnings:

  - You are about to drop the column `yjsState` on the `Document` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Document" DROP COLUMN "yjsState",
ADD COLUMN     "canvasData" JSONB;
