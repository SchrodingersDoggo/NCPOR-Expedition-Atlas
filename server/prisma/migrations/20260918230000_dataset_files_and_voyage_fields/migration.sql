-- Step 4: one DatasetMetadata record can now own many files (raw,
-- processed, documentation, calibration, derived...) instead of exactly
-- one. The old single content_item_id link on dataset_metadata is
-- replaced by a new dataset_files join table.
--
-- Step 5: Expedition gains ship_name / voyage_code so it can carry the
-- same voyage-identifying fields NPDC's "Scientific Voyage Details" table
-- shows (Ship Name, Voyage Name) alongside its existing `name`.

-- CreateEnum
CREATE TYPE "FileRole" AS ENUM ('raw', 'processed', 'documentation', 'calibration', 'derived', 'other');

-- CreateTable
CREATE TABLE "dataset_files" (
    "id" TEXT NOT NULL,
    "dataset_metadata_id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "role" "FileRole" NOT NULL DEFAULT 'raw',
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataset_files_content_item_id_key" ON "dataset_files"("content_item_id");

-- CreateIndex
CREATE INDEX "dataset_files_dataset_metadata_id_idx" ON "dataset_files"("dataset_metadata_id");

-- CreateIndex
CREATE INDEX "dataset_files_role_idx" ON "dataset_files"("role");

-- AddForeignKey
ALTER TABLE "dataset_files" ADD CONSTRAINT "dataset_files_dataset_metadata_id_fkey" FOREIGN KEY ("dataset_metadata_id") REFERENCES "dataset_metadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_files" ADD CONSTRAINT "dataset_files_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: carry over any existing single-file link from
-- dataset_metadata.content_item_id as a 'raw' DatasetFile row before that
-- column is dropped. (If the previous migration was never applied to this
-- database — e.g. this is a fresh setup — dataset_metadata.content_item_id
-- won't exist and this INSERT/backfill has nothing to do; it's still safe
-- because the WHERE clause only matches rows that actually have a value.)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dataset_metadata' AND column_name = 'content_item_id'
  ) THEN
    INSERT INTO "dataset_files" ("id", "dataset_metadata_id", "content_item_id", "role", "created_at")
    SELECT gen_random_uuid()::text, "id", "content_item_id", 'raw', "created_at"
    FROM "dataset_metadata"
    WHERE "content_item_id" IS NOT NULL;

    ALTER TABLE "dataset_metadata" DROP CONSTRAINT IF EXISTS "dataset_metadata_content_item_id_fkey";
    DROP INDEX IF EXISTS "dataset_metadata_content_item_id_key";
    ALTER TABLE "dataset_metadata" DROP COLUMN "content_item_id";
  END IF;
END $$;

-- Step 5: voyage-identity fields on Expedition
ALTER TABLE "expeditions" ADD COLUMN "ship_name" TEXT;
ALTER TABLE "expeditions" ADD COLUMN "voyage_code" TEXT;
