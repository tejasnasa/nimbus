-- CreateTable
CREATE TABLE "segment_translation" (
    "segmentId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segment_translation_pkey" PRIMARY KEY ("segmentId","language")
);

-- AddForeignKey
ALTER TABLE "segment_translation" ADD CONSTRAINT "segment_translation_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "transcript_segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
