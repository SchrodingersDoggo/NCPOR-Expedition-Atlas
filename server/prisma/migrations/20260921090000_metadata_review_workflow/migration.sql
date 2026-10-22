-- Scientific-metadata review workflow: two new lifecycle states, plus a
-- durable audit log of every review action taken on a DatasetMetadata
-- record (Start Review, Request Changes with its required comment,
-- Approve, Publish, Archive, and a researcher's resubmission).

ALTER TYPE "MetadataStatus" ADD VALUE 'changes_requested';
ALTER TYPE "MetadataStatus" ADD VALUE 'archived';

CREATE TABLE "metadata_review_history" (
    "id" TEXT NOT NULL,
    "metadata_id" TEXT NOT NULL,
    "reviewer_id" TEXT,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "old_status" "MetadataStatus" NOT NULL,
    "new_status" "MetadataStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metadata_review_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "metadata_review_history_metadata_id_created_at_idx" ON "metadata_review_history"("metadata_id", "created_at");

ALTER TABLE "metadata_review_history" ADD CONSTRAINT "metadata_review_history_metadata_id_fkey" FOREIGN KEY ("metadata_id") REFERENCES "dataset_metadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metadata_review_history" ADD CONSTRAINT "metadata_review_history_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
