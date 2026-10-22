-- Archive module (Phase 6)
-- Adds classification/queue fields to content_items. No existing columns
-- are altered or dropped, and no data is duplicated — region/expedition
-- relationships are still resolved through the existing `expeditions`
-- table wherever an item is attached to one.

-- CreateEnum
CREATE TYPE "ResearchDomain" AS ENUM ('climate_science', 'glaciology', 'oceanography', 'atmospheric_science', 'geology', 'biology_ecology', 'other');

-- AlterTable
ALTER TABLE "content_items"
  ADD COLUMN "region" "Region",
  ADD COLUMN "research_domain" "ResearchDomain",
  ADD COLUMN "authors" TEXT,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "archive_year" INTEGER,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "content_items_archive_year_idx" ON "content_items"("archive_year");

-- CreateIndex
CREATE INDEX "content_items_region_idx" ON "content_items"("region");

-- CreateIndex
CREATE INDEX "content_items_research_domain_idx" ON "content_items"("research_domain");

-- CreateIndex
CREATE INDEX "content_items_type_status_idx" ON "content_items"("type", "status");

-- Backfill archive_year for existing rows so the Year Timeline has data
-- immediately: prefer the linked expedition's start year, falling back to
-- the year the item was created.
UPDATE "content_items" AS c
SET "archive_year" = COALESCE(
  EXTRACT(YEAR FROM e."start_date")::int,
  EXTRACT(YEAR FROM c."created_at")::int
)
FROM "expeditions" AS e
WHERE c."expedition_id" = e."id" AND c."archive_year" IS NULL;

UPDATE "content_items"
SET "archive_year" = EXTRACT(YEAR FROM "created_at")::int
WHERE "archive_year" IS NULL;

-- Backfill region from the linked expedition where the item doesn't
-- already carry its own region.
UPDATE "content_items" AS c
SET "region" = e."region"
FROM "expeditions" AS e
WHERE c."expedition_id" = e."id" AND c."region" IS NULL AND e."region" IS NOT NULL;
