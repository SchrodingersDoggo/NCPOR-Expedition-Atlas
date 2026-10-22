-- Controlled vocabulary for Scientific Keywords (Tag): a status column
-- turns the free-for-all tag table into a moderated one. Existing rows
-- default to 'pending' same as new ones would via the app, but since this
-- app has not been deployed against a live database yet, that's a
-- theoretical safety net rather than a real backfill concern.

-- CreateEnum
CREATE TYPE "TagStatus" AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE "tags" ADD COLUMN "status" "TagStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE "tags" ADD COLUMN "suggested_by" TEXT;
ALTER TABLE "tags" ADD COLUMN "reviewed_by" TEXT;
ALTER TABLE "tags" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "tags_status_idx" ON "tags"("status");

ALTER TABLE "tags" ADD CONSTRAINT "tags_suggested_by_fkey" FOREIGN KEY ("suggested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tags" ADD CONSTRAINT "tags_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Controlled research-location vocabulary: region -> station -> coordinates
-- (NPDC's "Browse by Location" drill-down). Admin-managed.

-- CreateTable
CREATE TABLE "stations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" "Region" NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stations_name_region_key" ON "stations"("name", "region");
CREATE INDEX "stations_region_idx" ON "stations"("region");

ALTER TABLE "dataset_metadata" ADD COLUMN "station_id" TEXT;
CREATE INDEX "dataset_metadata_station_id_idx" ON "dataset_metadata"("station_id");
ALTER TABLE "dataset_metadata" ADD CONSTRAINT "dataset_metadata_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed a starting set of well-known NCPOR stations so the "Browse by
-- Location" facet isn't empty on day one. Coordinates match the ones
-- already used elsewhere in this app (server/data/researchStations.data.js,
-- the Explorer globe's static station list) for the three Antarctic
-- entries, plus Himadri (India's Arctic station, Ny-Ålesund, Svalbard).
-- These are illustrative starting points, not authoritative NCPOR data —
-- an admin can correct or add to them via the Station admin endpoints.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "stations" ("id", "name", "region", "latitude", "longitude", "description", "created_at") VALUES
  (gen_random_uuid()::text, 'Maitri', 'Antarctic', -70.77, 11.73, 'Indian scientific research station established in 1989.', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Bharati', 'Antarctic', -69.41, 76.19, 'Indian Antarctic research station commissioned in 2012.', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Dakshin Gangotri', 'Antarctic', -70.08, -12.00, 'First Indian scientific base in Antarctica (1983).', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Himadri', 'Arctic', 78.92, 11.92, 'India''s Arctic research station at Ny-Ålesund, Svalbard.', CURRENT_TIMESTAMP)
ON CONFLICT ("name", "region") DO NOTHING;
