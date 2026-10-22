-- Dataset Metadata (NPDC parity): metadata-first workflow. A researcher can
-- describe a dataset (title, PI, location, observation period, scientific
-- classification, citation, access conditions...) and save that record
-- before any actual/processed data file exists. content_item_id stays
-- NULL until a file is later attached.

-- CreateEnum
CREATE TYPE "MetadataStatus" AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'published');

-- CreateEnum
CREATE TYPE "ProcessingLevel" AS ENUM ('raw', 'processed', 'calibrated', 'derived');

-- CreateTable
CREATE TABLE "dataset_metadata" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "expedition_id" TEXT,
    "content_item_id" TEXT,
    "principal_investigator" TEXT,
    "institution" TEXT DEFAULT 'NCPOR',
    "region" "Region",
    "exact_location" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "observation_start" DATE,
    "observation_end" DATE,
    "discipline" "ResearchDomain",
    "keywords" TEXT[],
    "parameters" TEXT[],
    "instrument_method" TEXT,
    "processing_level" "ProcessingLevel",
    "access_conditions" TEXT,
    "citation" TEXT,
    "file_format" TEXT,
    "units" TEXT,
    "status" "MetadataStatus" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMP(3),
    "client_request_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dataset_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataset_metadata_content_item_id_key" ON "dataset_metadata"("content_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_metadata_client_request_id_key" ON "dataset_metadata"("client_request_id");

-- CreateIndex
CREATE INDEX "dataset_metadata_status_idx" ON "dataset_metadata"("status");

-- CreateIndex
CREATE INDEX "dataset_metadata_expedition_id_idx" ON "dataset_metadata"("expedition_id");

-- CreateIndex
CREATE INDEX "dataset_metadata_discipline_idx" ON "dataset_metadata"("discipline");

-- CreateIndex
CREATE INDEX "dataset_metadata_created_by_content_item_id_idx" ON "dataset_metadata"("created_by", "content_item_id");

-- AddForeignKey
ALTER TABLE "dataset_metadata" ADD CONSTRAINT "dataset_metadata_expedition_id_fkey" FOREIGN KEY ("expedition_id") REFERENCES "expeditions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_metadata" ADD CONSTRAINT "dataset_metadata_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_metadata" ADD CONSTRAINT "dataset_metadata_principal_investigator_fkey" FOREIGN KEY ("principal_investigator") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_metadata" ADD CONSTRAINT "dataset_metadata_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
